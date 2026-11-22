import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Badge, Money, fmtDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Billing() {
  const u = await requireUser();
  const [invoices, pays, orders] = await Promise.all([
    db().select().from(schema.invoices).where(eq(schema.invoices.userId, u.id)).orderBy(desc(schema.invoices.issuedAt)).limit(200),
    db().select().from(schema.payments).where(eq(schema.payments.userId, u.id)).orderBy(desc(schema.payments.createdAt)).limit(200),
    db().select().from(schema.orders).where(eq(schema.orders.userId, u.id)).orderBy(desc(schema.orders.createdAt)).limit(50),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="h1">Billing & invoices</h1>
      <section className="card overflow-x-auto p-0"><h2 className="h2 p-5 pb-2">Invoices</h2>
        <table className="table"><thead><tr><th>Invoice</th><th>Date</th><th>Description</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>{invoices.map((i) => (<tr key={i.id}><td>INV-{String(i.number).padStart(6, "0")}</td><td>{fmtDateTime(i.issuedAt)}</td><td className="max-w-xs truncate">{i.lines[0]?.description}</td><td><Money fils={i.totalFils} /></td><td><Badge value={i.status} /></td><td className="text-right"><Link className="text-brand-700" href={`/portal/invoices/${i.id}`}>View / print</Link></td></tr>))}
          {!invoices.length && <tr><td colSpan={6} className="muted">No invoices yet.</td></tr>}</tbody></table></section>
      <section className="card overflow-x-auto p-0"><h2 className="h2 p-5 pb-2">Payment history</h2>
        <table className="table"><thead><tr><th>Date</th><th>Reference</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{pays.map((p) => (<tr key={p.id}><td>{fmtDateTime(p.createdAt)}</td><td className="font-mono text-xs">{p.gatewayRef}</td><td>{p.method}</td><td><Money fils={p.amountFils} /></td><td><Badge value={p.status === "captured" ? "paid" : p.status} /></td></tr>))}
          {!pays.length && <tr><td colSpan={5} className="muted">No payments yet.</td></tr>}</tbody></table></section>
      <section className="card overflow-x-auto p-0"><h2 className="h2 p-5 pb-2">Orders</h2>
        <table className="table"><thead><tr><th>Date</th><th>Type</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{orders.map((o) => (<tr key={o.id}><td>{fmtDateTime(o.createdAt)}</td><td>{o.kind}</td><td><Money fils={o.totalFils} /></td><td><Badge value={o.status} /></td></tr>))}</tbody></table></section>
    </div>
  );
}
