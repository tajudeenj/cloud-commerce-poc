"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CYCLES } from "@/lib/billing-math";
import { clientIp, currentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { runAction, type FormState } from "@/lib/action";
import { quote } from "@/lib/services/catalog";
import { startCheckout } from "@/lib/services/orders";
import { track } from "@/lib/services/analytics";
import { DomainError } from "@/lib/services/catalog";
import { IntegrationError } from "@/lib/adapters/http";

const selection = z.object({
  productSlug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  planCode: z.string().regex(/^[A-Z0-9-]{1,40}$/),
  cycle: z.enum(CYCLES),
  addonCodes: z.array(z.string().regex(/^[A-Z0-9-]{1,40}$/)).max(20),
  couponCode: z.string().trim().max(40).optional().nullable(),
  config: z.object({
    region: z.string().max(40).optional(),
    os: z.string().max(60).optional(),
    hostname: z.string().max(253).optional(),
  }),
});
export type Selection = z.infer<typeof selection>;

export type QuoteView = {
  lines: { description: string; amountFils: number }[];
  subtotalFils: number; discountFils: number; totalFils: number; couponMessage: string | null; couponApplied: boolean;
} | { error: string };

/** Live pricing for the configurator (server-authoritative; prices come from CRM via cache). */
export async function quoteAction(input: Selection): Promise<QuoteView> {
  const ip = await clientIp();
  if (!rateLimit(`quote:${ip}`, 120, 60_000).ok) return { error: "Too many requests — slow down a little." };
  const parsed = selection.safeParse(input);
  if (!parsed.success) return { error: "Invalid selection" };
  try {
    const { hostname: _h, ...cfg } = parsed.data.config; // hostname is validated at checkout, not while typing
    const q = await quote({ ...parsed.data, config: cfg });
    const vid = (await cookies()).get("vid")?.value;
    if (vid && rateLimit(`ev:configure:${vid}:${parsed.data.productSlug}`, 1, 30 * 60_000).ok) {
      const u = await currentUser();
      await track({ userId: u?.id, visitorId: vid, type: "configure", data: { product: parsed.data.productSlug } });
    }
    return {
      lines: q.lines.map((l) => ({ description: l.description, amountFils: l.amountFils })),
      subtotalFils: q.subtotalFils, discountFils: q.discountFils, totalFils: q.totalFils,
      couponMessage: q.couponMessage, couponApplied: q.couponId !== null,
    };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    if (e instanceof IntegrationError) return { error: "Live pricing is temporarily unavailable." };
    console.error("[quote]", e);
    return { error: "Unable to price this configuration." };
  }
}

export async function checkoutAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const raw = JSON.parse(String(fd.get("selection") ?? "{}"));
    const sel = selection.parse(raw);
    const key = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).parse(fd.get("idempotencyKey"));
    const user = await currentUser();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/products/${sel.productSlug}`)}`);
    if (user.role === "admin" && !user.impersonatorId) return { error: "Admin accounts cannot place orders. Use a customer account or ‘Login as client’." };
    const ip = await clientIp();
    if (!rateLimit(`checkout:${user.id}`, 20, 10 * 60_000).ok) return { error: "Too many checkout attempts. Please wait a few minutes." };
    const { redirectUrl } = await startCheckout({ userId: user.id, impersonatorId: user.impersonatorId, ip }, sel, key);
    redirect(redirectUrl);
  });
}
