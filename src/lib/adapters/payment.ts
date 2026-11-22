import "server-only";
import { env } from "@/lib/env";
import { canonical, hmacSha256, randomToken, safeEqual } from "@/lib/crypto";
import { httpJson } from "./http";

/**
 * Payment gateway contract. Card data is captured ONLY on the gateway's hosted page —
 * this platform never sees PAN/CVV, which keeps it out of PCI DSS card-data scope (SAQ-A style).
 */
export type PaymentResult = {
  orderId: string;
  status: "success" | "failed";
  amountFils: number;
  txnRef: string;
  token?: string;
  method?: string;
};

export interface PaymentAdapter {
  hostedPaymentUrl(o: { orderId: string; amountFils: number; description: string }): string;
  /** Verifies the signed redirect/callback from the gateway. Returns null when the signature is invalid. */
  verifyCallback(params: Record<string, string>): PaymentResult | null;
  /** Merchant-initiated charge on a stored token (renewals). */
  chargeToken(o: { token: string; amountFils: number; reference: string }): Promise<{ ok: boolean; txnRef: string }>;
}

const SIGNED_FIELDS = ["orderId", "status", "amount", "txnRef", "token", "method", "ts"] as const;
const MAX_CALLBACK_AGE_MS = 15 * 60 * 1000;

export function signParams(params: Record<string, string>): string {
  return hmacSha256(env().PAYMENT_HMAC_SECRET, canonical(params));
}

function verifySigned(params: Record<string, string>): PaymentResult | null {
  const picked: Record<string, string> = {};
  for (const f of SIGNED_FIELDS) picked[f] = params[f] ?? "";
  const sig = params.sig ?? "";
  if (!sig || !safeEqual(sig, signParams(picked))) return null;
  const ts = Number(picked.ts);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CALLBACK_AGE_MS) return null;
  const amount = Number(picked.amount);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  if (picked.status !== "success" && picked.status !== "failed") return null;
  return {
    orderId: picked.orderId!, status: picked.status, amountFils: amount, txnRef: picked.txnRef!,
    token: picked.token || undefined, method: picked.method || undefined,
  };
}

class MockGateway implements PaymentAdapter {
  hostedPaymentUrl(o: { orderId: string; amountFils: number; description: string }) {
    const req = { orderId: o.orderId, amount: String(o.amountFils), description: o.description.slice(0, 120) };
    const qs = new URLSearchParams({ ...req, sig: signParams(req) });
    return `/mock-gateway?${qs}`;
  }
  verifyCallback(params: Record<string, string>) {
    return verifySigned(params);
  }
  async chargeToken(o: { token: string; amountFils: number; reference: string }) {
    // Deterministic test behaviour: tokens issued for card 4000 0000 0000 0002 decline.
    return { ok: !o.token.startsWith("tok_decline"), txnRef: `TXN-${randomToken(9)}` };
  }
}

class HttpGateway implements PaymentAdapter {
  hostedPaymentUrl(o: { orderId: string; amountFils: number; description: string }) {
    const base = env().PAYMENT_GATEWAY_URL ?? "";
    const req = { orderId: o.orderId, amount: String(o.amountFils), description: o.description.slice(0, 120),
      returnUrl: `${env().APP_BASE_URL}/checkout/callback` };
    return `${base}/hosted?${new URLSearchParams({ ...req, sig: signParams(req) })}`;
  }
  verifyCallback(params: Record<string, string>) {
    return verifySigned(params);
  }
  async chargeToken(o: { token: string; amountFils: number; reference: string }) {
    const r = await httpJson<{ approved: boolean; txnRef: string }>(`${env().PAYMENT_GATEWAY_URL}/charges`, {
      method: "POST", body: { token: o.token, amount: o.amountFils, currency: "JOD", reference: o.reference },
      idempotencyKey: o.reference, retries: 1,
    });
    return { ok: r.approved, txnRef: r.txnRef };
  }
}

const g = globalThis as unknown as { __pay?: PaymentAdapter };
export function payments(): PaymentAdapter {
  return (g.__pay ??= env().PAYMENT_MODE === "http" ? new HttpGateway() : new MockGateway());
}
