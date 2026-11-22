import type { NextRequest } from "next/server";
import { z } from "zod";
import { randomToken, safeEqual } from "@/lib/crypto";
import { signParams } from "@/lib/adapters/payment";

/**
 * Simulates the external gateway processing its hosted card form. A real gateway lives on its own
 * domain and returns the customer with a full-page 303 redirect — reproduced here. Card data is
 * validated and discarded; only a signed result (with an opaque token) comes back to the platform.
 */
const see = (location: string) => new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return new Response("Forbidden", { status: 403 });

  const fd = await req.formData();
  const get = (k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
  const req0 = { orderId: get("orderId"), amount: get("amount"), description: get("description").slice(0, 120) };
  const back = (error: string) => see(`/mock-gateway?${new URLSearchParams({ ...req0, sig: get("sig"), error })}`);

  if (!z.string().uuid().safeParse(req0.orderId).success || !/^\d{1,12}$/.test(req0.amount)) return new Response("Bad request", { status: 400 });
  if (!safeEqual(get("sig"), signParams(req0))) return new Response("Invalid payment request signature", { status: 400 });

  const cancelled = get("intent") === "cancel";
  const pan = get("card").replace(/\s+/g, "");
  if (!cancelled) {
    if (!/^\d{16}$/.test(pan) || !luhn(pan)) return back("Card number is invalid.");
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(get("expiry"))) return back("Expiry must be MM/YY.");
    if (!/^\d{3,4}$/.test(get("cvv"))) return back("CVV is invalid.");
  }
  const declined = cancelled || pan === "4000000000000002";
  const result = {
    orderId: req0.orderId, status: declined ? "failed" : "success", amount: req0.amount, txnRef: `TXN-${randomToken(9)}`,
    token: declined ? "" : `tok_${randomToken(12)}`, method: pan.startsWith("5") ? "mastercard" : "visa", ts: String(Date.now()),
  };
  return see(`/checkout/callback?${new URLSearchParams({ ...result, sig: signParams(result) })}`);
}

function luhn(n: string) {
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
