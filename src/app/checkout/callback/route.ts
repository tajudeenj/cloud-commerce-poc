import type { NextRequest } from "next/server";
import { payments } from "@/lib/adapters/payment";
import { completePayment } from "@/lib/services/orders";

/** Gateway return URL. Trusts nothing in the query except what the HMAC signature covers. */
export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = payments().verifyCallback(params);
  // Relative Location keeps the user on the exact host they came from (behind proxies/LBs the
  // internal origin differs from the public one, which would drop the session cookie).
  const to = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
  if (!result) return to("/checkout/result?status=invalid");
  try {
    const r = await completePayment(result);
    if (r.status === "paid" && r.subscriptionId) return to(`/portal/services/${r.subscriptionId}?msg=paid`);
    return to(`/checkout/result?status=${r.status}&order=${r.orderId}`);
  } catch (e) {
    console.error("[callback]", e);
    return to("/checkout/result?status=error");
  }
}
