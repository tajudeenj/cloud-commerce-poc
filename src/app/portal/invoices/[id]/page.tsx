import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { Money, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Admins can view any invoice; customers only their own.
  const inv = await db().query.invoices.findFirst({ where: u.role === "admin" ? eq(schema.invoices.id, id) : and(eq(schema.invoices.id, id), eq(schema.invoices.userId, u.id)) });
  if (!inv) notFound();
  const customer = await db().query.users.findFirst({ where: eq(schema.users.id, inv.userId) });
  return (
    <article className="card mx-auto max-w-3xl p-10 print:border-0 print:shadow-none">
      <header className="mb-8 flex justify-between">
        <div><p className="text-2xl font-bold">{env().BRAND_NAME}</p><p className="muted">Amman, Jordan</p></div>
        <div className="text-right"><p className="text-xl font-bold">INVOICE</p><p>INV-{String(inv.number).padStart(6, "0")}</p><p className="muted">{fmtDate(inv.issuedAt)}</p></div>
      </header>
      <p className="mb-6 text-sm"><b>Billed to:</b> {customer?.name} — {customer?.email}{customer?.crmCustomerId ? ` (CRM ${customer.crmCustomerId})` : ""}</p>
      <table className="table"><thead><tr><th>Description</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{inv.lines.map((l, i) => (<tr key={i}><td>{l.description}</td><td className="text-right"><Money fils={l.amountFils} /></td></tr>))}</tbody></table>
      <dl className="ml-auto mt-6 w-64 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd><Money fils={inv.subtotalFils} /></dd></div>
        {inv.discountFils > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd>−<Money fils={inv.discountFils} /></dd></div>}
        <div className="flex justify-between border-t pt-1 text-base font-bold"><dt>Total ({inv.status})</dt><dd><Money fils={inv.totalFils} /></dd></div>
      </dl>
      <p className="muted mt-10 text-xs">Amounts in Jordanian Dinars. Use your browser’s Print → Save as PDF to download.</p>
    </article>
  );
}
