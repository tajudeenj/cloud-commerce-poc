import { requireAdmin } from "@/lib/auth";
import { dashboard } from "@/lib/services/analytics";
import { Badge, Money, fmtDateTime } from "@/components/ui";
import { formatJod } from "@/lib/billing-math";

export const dynamic = "force-dynamic";

const STEP: Record<string, string> = { product_view: "Viewed product", configure: "Configured", checkout_started: "Started checkout", purchased: "Purchased" };

export default async function AdminHome() {
  await requireAdmin();
  const d = await dashboard(30);
  const top = Math.max(1, ...d.funnel.map((f) => f.visitors));
  const maxDay = Math.max(1, ...d.daily.map((x) => x.total));
  return (
    <div className="space-y-6">
      <h1 className="h1">Dashboard <span className="muted font-normal">· last 30 days</span></h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Revenue", formatJod(d.revenueFils), `${d.paymentsCount} payments`], ["MRR", formatJod(d.mrrFils), "normalised monthly"],
          ["Active services", String(d.activeSubs), "incl. provisioning"], ["Open tickets", String(d.openTickets), "not closed"]].map(([l, v, s]) => (
          <div key={l} className="card"><p className="muted">{l}</p><p className="mt-1 text-2xl font-bold">{v}</p><p className="muted text-xs">{s}</p></div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card"><h2 className="h2 mb-4">Conversion funnel (unique visitors)</h2>
          <ul className="space-y-3">{d.funnel.map((f) => (
            <li key={f.step}><div className="mb-1 flex justify-between text-sm"><span>{STEP[f.step]}</span><b>{f.visitors}</b></div>
              <div className="h-3 rounded bg-slate-100"><div className="h-3 rounded bg-brand-500" style={{ width: `${(f.visitors / top) * 100}%` }} /></div></li>
          ))}</ul></section>
        <section className="card"><h2 className="h2 mb-4">Daily revenue <span className="muted font-normal">· 14 days</span></h2>
          <div className="flex h-40 items-end gap-1" role="img" aria-label="Daily revenue, last 14 days">
            {d.daily.map((x) => <div key={x.day} title={`${x.day}: ${formatJod(x.total)}`} className={`flex-1 rounded-t ${x.total ? "bg-brand-500" : "bg-slate-100"}`} style={{ height: `${x.total ? Math.max(6, (x.total / maxDay) * 100) : 3}%` }} />)}
          </div>
          <div className="mt-1 flex justify-between text-xs text-ink-500"><span>{d.daily[0]?.day}</span><span>{d.daily.at(-1)?.day}</span></div></section>
        <section className="card overflow-x-auto p-0"><h2 className="h2 p-5 pb-2">By product</h2>
          <table className="table"><thead><tr><th>Product</th><th>Live services</th><th>MRR</th></tr></thead>
            <tbody>{d.byProduct.map((p) => <tr key={p.product}><td>{p.product}</td><td>{p.subs}</td><td><Money fils={p.mrr} /></td></tr>)}</tbody></table></section>
        <section className="card overflow-x-auto p-0"><h2 className="h2 p-5 pb-2">Abandoned / failed checkouts</h2>
          <table className="table"><thead><tr><th>Customer</th><th>Value</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{d.abandoned.map((o) => <tr key={o.id}><td>{o.email}</td><td><Money fils={o.total} /></td><td><Badge value={o.status} /></td><td>{fmtDateTime(o.createdAt)}</td></tr>)}
            {!d.abandoned.length && <tr><td colSpan={4} className="muted">None 🎉</td></tr>}</tbody></table></section>
      </div>
    </div>
  );
}
