import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ActionForm, Submit } from "@/components/form";
import { Badge, Money, fmtDate } from "@/components/ui";
import { createCouponAction, toggleCouponAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Coupons() {
  await requireAdmin();
  const rows = await db().select().from(schema.coupons).orderBy(desc(schema.coupons.createdAt));
  return (
    <div className="space-y-6"><h1 className="h1">Coupons & promotions</h1>
      <ActionForm action={createCouponAction} className="card grid gap-3 md:grid-cols-6 md:items-end">
        <div className="md:col-span-2"><label className="label">Code</label><input name="code" className="input" required placeholder="RAMADAN20" /></div>
        <div><label className="label">Type</label><select name="kind" className="input"><option value="percent">% off</option><option value="fixed">JOD off</option></select></div>
        <div><label className="label">Value</label><input name="value" className="input" required placeholder="20 or 5.000" /></div>
        <div><label className="label">Max uses</label><input name="max" type="number" min={1} className="input" /></div>
        <div><label className="label">Valid until</label><input name="until" type="date" className="input" /></div>
        <div className="md:col-span-6 text-right"><Submit>Create coupon</Submit></div>
      </ActionForm>
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Code</th><th>Discount</th><th>Redeemed</th><th>Valid until</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.map((c) => (<tr key={c.id}><td className="font-mono">{c.code}</td><td>{c.kind === "percent" ? `${c.value}%` : <Money fils={c.value} />}</td><td>{c.redeemed}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}</td><td>{fmtDate(c.validUntil)}</td><td><Badge value={c.active ? "active" : "disabled"} /></td>
          <td><form action={toggleCouponAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(!c.active)} /><button className="btn-secondary py-1 text-xs">{c.active ? "Disable" : "Enable"}</button></form></td></tr>))}</tbody></table></div>
    </div>
  );
}
