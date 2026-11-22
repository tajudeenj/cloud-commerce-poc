import { requireAdmin } from "@/lib/auth";
import { listSubscriptions } from "@/lib/services/admin";
import { Badge, Money, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Subs() {
  await requireAdmin();
  const rows = await listSubscriptions();
  return (
    <div className="space-y-6"><h1 className="h1">Subscriptions</h1>
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Customer</th><th>Service</th><th>Status</th><th>Cycle</th><th>Price</th><th>Period end</th><th>Backend ref</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.email}</td><td>{r.product} — {r.plan}</td><td><Badge value={r.status} /></td><td>{r.cycle}</td><td><Money fils={r.price} /></td><td>{fmtDate(r.periodEnd)}</td><td className="font-mono text-xs">{r.ref ?? "—"}</td></tr>)}</tbody></table></div>
    </div>
  );
}
