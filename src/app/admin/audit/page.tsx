import { requireAdmin } from "@/lib/auth";
import { recentAudit } from "@/lib/services/admin";
import { fmtDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Audit() {
  await requireAdmin();
  const rows = await recentAudit();
  return (
    <div className="space-y-6"><h1 className="h1">Audit trail</h1>
      <p className="muted">Append-only — the database rejects any UPDATE or DELETE on this table.</p>
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.id}><td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</td><td>{r.actor ?? "system"}{r.impersonator && <span className="block text-xs text-amber-700">via {r.impersonator}</span>}</td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.entity}{r.entityId ? ` ${r.entityId.slice(0, 8)}` : ""}</td><td className="max-w-xs truncate font-mono text-xs" title={JSON.stringify(r.data)}>{JSON.stringify(r.data)}</td><td className="text-xs">{r.ip ?? ""}</td></tr>))}</tbody></table></div>
    </div>
  );
}
