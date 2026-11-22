import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Badge, Money, fmtDate } from "@/components/ui";
import { CYCLE_LABEL, type Cycle } from "@/lib/billing-math";

export const dynamic = "force-dynamic";

export default async function Portal() {
  const u = await requireUser();
  const subs = await db().select({
    id: schema.subscriptions.id, status: schema.subscriptions.status, cycle: schema.subscriptions.cycle,
    price: schema.subscriptions.pricePerCycleFils, end: schema.subscriptions.currentPeriodEnd, ref: schema.subscriptions.externalRef,
    product: schema.products.name, plan: schema.plans.name, config: schema.subscriptions.config,
  }).from(schema.subscriptions)
    .innerJoin(schema.products, eq(schema.products.id, schema.subscriptions.productId))
    .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .where(eq(schema.subscriptions.userId, u.id)).orderBy(desc(schema.subscriptions.createdAt));
  return (
    <div className="space-y-6">
      <h1 className="h1">My services</h1>
      {subs.length === 0 ? (
        <div className="card text-center"><p className="muted">You have no services yet.</p><Link href="/#products" className="btn-primary mt-4">Browse services</Link></div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Service</th><th>Status</th><th>Billing</th><th>Renews / ends</th><th></th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.product}</b> — {s.plan}<br /><span className="muted text-xs">{s.config.hostname ?? s.ref ?? "—"}</span></td>
                  <td><Badge value={s.status} /></td>
                  <td><Money fils={s.price} /> <span className="muted">/ {CYCLE_LABEL[s.cycle as Cycle].toLowerCase()}</span></td>
                  <td>{fmtDate(s.end)}</td>
                  <td className="text-right"><Link className="font-semibold text-brand-700" href={`/portal/services/${s.id}`}>Manage →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
