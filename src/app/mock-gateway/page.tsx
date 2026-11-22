import type { Metadata } from "next";
import { formatJod } from "@/lib/billing-math";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Secure payment (test gateway)", robots: { index: false } };

export default async function MockGateway({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const amount = Number(sp.amount ?? "0");
  return (
    <div className="mx-auto max-w-md py-8">
      <div className="mb-3 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        TEST PAYMENT GATEWAY — stands in for the bank&apos;s hosted page (3-D Secure). Use 4111 1111 1111 1111 to approve or 4000 0000 0000 0002 to decline.
      </div>
      <div className="card">
        <div className="mb-5 flex items-center justify-between"><h1 className="h2">Secure checkout</h1><span className="text-xs font-semibold text-ink-500">VISA · Mastercard</span></div>
        <p className="muted">{sp.description}</p>
        <p className="mb-5 mt-1 text-3xl font-bold">{Number.isSafeInteger(amount) ? formatJod(amount) : "—"}</p>
        {sp.error && <div className="mb-4"><Alert kind="error">{sp.error}</Alert></div>}
        {/* Plain HTML form → full-page POST, exactly like a real hosted payment page. */}
        <form method="post" action="/mock-gateway/pay" className="space-y-4">
          {["orderId", "amount", "description", "sig"].map((k) => <input key={k} type="hidden" name={k} value={sp[k] ?? ""} />)}
          <div><label className="label" htmlFor="card">Card number</label><input className="input font-mono" id="card" name="card" inputMode="numeric" autoComplete="cc-number" defaultValue="4111 1111 1111 1111" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="expiry">Expiry (MM/YY)</label><input className="input" id="expiry" name="expiry" autoComplete="cc-exp" defaultValue="12/29" /></div>
            <div><label className="label" htmlFor="cvv">CVV</label><input className="input" id="cvv" name="cvv" inputMode="numeric" autoComplete="cc-csc" defaultValue="123" /></div>
          </div>
          <div className="flex gap-2">
            <button type="submit" name="intent" value="pay" className="btn-primary flex-1 py-3">Pay now</button>
            <button type="submit" name="intent" value="cancel" className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
