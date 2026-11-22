"use client";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CYCLES, CYCLE_DISCOUNT_BPS, CYCLE_LABEL, formatJod, type Cycle } from "@/lib/billing-math";
import { Submit } from "@/components/form";
import { checkoutAction, quoteAction, type QuoteView, type Selection } from "./actions";

type Plan = { code: string; name: string; specs: Record<string, string>; monthlyFils: number };
type Addon = { code: string; name: string; description: string; monthlyFils: number };

export function Configurator(props: {
  productSlug: string; options: Record<string, string[]>; plans: Plan[]; addons: Addon[];
  hostnameLabel: string; initialKey: string; signedIn: boolean;
}) {
  const { plans, addons, options } = props;
  const [planCode, setPlan] = useState(plans[Math.min(1, plans.length - 1)]?.code ?? "");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [selAddons, setAddons] = useState<string[]>([]);
  const [region, setRegion] = useState(options.regions?.[0] ?? "");
  const [os, setOs] = useState(options.os?.[0] ?? "");
  const [hostname, setHostname] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [q, setQ] = useState<QuoteView | null>(null);
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState(props.initialKey);
  const seq = useRef(0);

  const selection: Selection = useMemo(() => ({
    productSlug: props.productSlug, planCode, cycle, addonCodes: selAddons, couponCode: coupon || null,
    config: { ...(region ? { region } : {}), ...(os ? { os } : {}), ...(hostname.trim() ? { hostname: hostname.trim() } : {}) },
  }), [props.productSlug, planCode, cycle, selAddons, coupon, region, os, hostname]);

  // Re-price on any material change (debounced; stale responses discarded).
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(() => startTransition(async () => {
      const r = await quoteAction(selection);
      if (id === seq.current) setQ(r);
    }), 200);
    // A changed selection must never reuse a previous order's idempotency key.
    setKey(crypto.randomUUID().replace(/-/g, ""));
    return () => clearTimeout(t);
  }, [planCode, cycle, selAddons, coupon, region, os]); // eslint-disable-line react-hooks/exhaustive-deps

  const [checkoutState, checkout] = useActionState(checkoutAction, undefined);
  const toggleAddon = (c: string) => setAddons((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c].sort()));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <section aria-labelledby="plan-h">
          <h2 id="plan-h" className="h2 mb-3">1. Choose a plan</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((p) => (
              <label key={p.code} className={`card cursor-pointer transition ${planCode === p.code ? "border-brand-500 ring-2 ring-brand-100" : "hover:border-slate-300"}`}>
                <input type="radio" name="plan" className="sr-only" checked={planCode === p.code} onChange={() => setPlan(p.code)} />
                <div className="flex items-baseline justify-between"><span className="font-semibold">{p.name}</span><span className="text-sm font-bold">{formatJod(p.monthlyFils)}<span className="font-normal text-ink-500">/mo</span></span></div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-700">
                  {Object.entries(p.specs).map(([k, v]) => (<div key={k} className="contents"><dt className="text-ink-500">{k}</dt><dd className="font-medium">{v}</dd></div>))}
                </dl>
              </label>
            ))}
          </div>
        </section>

        <section aria-labelledby="cycle-h">
          <h2 id="cycle-h" className="h2 mb-3">2. Billing cycle</h2>
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1" role="radiogroup">
            {CYCLES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${cycle === c ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-slate-100"}`}>
                {CYCLE_LABEL[c]}{CYCLE_DISCOUNT_BPS[c] > 0 && <span className="ml-1 text-xs opacity-80">−{CYCLE_DISCOUNT_BPS[c] / 100}%</span>}
              </button>
            ))}
          </div>
        </section>

        {(options.regions?.length || options.os?.length) ? (
          <section aria-labelledby="cfg-h">
            <h2 id="cfg-h" className="h2 mb-3">3. Configure</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {options.regions?.length ? (
                <div><label className="label" htmlFor="region">Region</label>
                  <select id="region" className="input" value={region} onChange={(e) => setRegion(e.target.value)}>{options.regions.map((r) => <option key={r}>{r}</option>)}</select></div>
              ) : null}
              {options.os?.length ? (
                <div><label className="label" htmlFor="os">Operating system</label>
                  <select id="os" className="input" value={os} onChange={(e) => setOs(e.target.value)}>{options.os.map((r) => <option key={r}>{r}</option>)}</select></div>
              ) : null}
              <div className="sm:col-span-2"><label className="label" htmlFor="hostname">{props.hostnameLabel}</label>
                <input id="hostname" className="input" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="e.g. web01.example.jo" maxLength={253} /></div>
            </div>
          </section>
        ) : (
          <section><h2 className="h2 mb-3">3. Configure</h2>
            <label className="label" htmlFor="hostname">{props.hostnameLabel}</label>
            <input id="hostname" className="input max-w-md" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="example.jo" maxLength={253} /></section>
        )}

        {addons.length > 0 && (
          <section aria-labelledby="addons-h">
            <h2 id="addons-h" className="h2 mb-3">4. Add-ons</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {addons.map((a) => (
                <label key={a.code} className={`card flex cursor-pointer items-start gap-3 ${selAddons.includes(a.code) ? "border-brand-500" : ""}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={selAddons.includes(a.code)} onChange={() => toggleAddon(a.code)} />
                  <span className="flex-1"><span className="block font-medium">{a.name}</span><span className="muted">{a.description}</span></span>
                  <span className="text-sm font-semibold">+{formatJod(a.monthlyFils)}/mo</span>
                </label>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="card space-y-4" aria-live="polite">
          <h2 className="h2">Order summary</h2>
          {!q ? <p className="muted">Calculating…</p> : "error" in q ? <p className="text-sm text-red-700">{q.error}</p> : (
            <>
              <ul className="space-y-2 text-sm">
                {q.lines.map((l) => <li key={l.description} className="flex justify-between gap-3"><span className="text-ink-700">{l.description}</span><span className="whitespace-nowrap font-medium">{formatJod(l.amountFils)}</span></li>)}
              </ul>
              {q.discountFils > 0 && <div className="flex justify-between text-sm text-emerald-700"><span>Discount</span><span>−{formatJod(q.discountFils)}</span></div>}
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
                <span className="font-semibold">Due today</span>
                <span className={`text-2xl font-bold ${pending ? "opacity-50" : ""}`}>{formatJod(q.totalFils)}</span>
              </div>
              <p className="muted text-xs">Billed {CYCLE_LABEL[cycle].toLowerCase()}. Prices in JOD, excluding GST. Live prices from CRM.</p>
            </>
          )}
          <div className="flex gap-2">
            <input aria-label="Coupon code" className="input" placeholder="Coupon code" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} maxLength={40} />
            <button type="button" className="btn-secondary" onClick={() => setCoupon(couponInput.trim())}>Apply</button>
          </div>
          {q && !("error" in q) && q.couponMessage && <p className={`text-xs ${q.couponApplied ? "text-emerald-700" : "text-red-700"}`}>{q.couponMessage}</p>}
          <form action={checkout}>
            <input type="hidden" name="selection" value={JSON.stringify(selection)} />
            <input type="hidden" name="idempotencyKey" value={key} />
            {checkoutState?.error && <p role="alert" className="mb-2 text-sm text-red-700">{checkoutState.error}</p>}
            <Submit className="btn-primary w-full py-3" pendingText="Redirecting to secure payment…">{props.signedIn ? "Continue to secure payment" : "Sign in to order"}</Submit>
          </form>
          <p className="text-center text-xs text-ink-500">🔒 Card details are entered on the payment gateway — never stored here.</p>
        </div>
      </aside>
    </div>
  );
}
