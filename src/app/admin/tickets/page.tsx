import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listTickets } from "@/lib/services/tickets";
import { Badge, fmtDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";
const FILTERS = ["all", "open", "customer_reply", "answered", "closed"];

export default async function AdminTickets({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status = "all" } = await searchParams;
  const rows = await listTickets({ status: FILTERS.includes(status) ? status : "all" }, 300);
  return (
    <div className="space-y-6"><h1 className="h1">Support tickets</h1>
      <div className="flex flex-wrap gap-2">{FILTERS.map((f) => <Link key={f} href={`/admin/tickets?status=${f}`} className={f === status ? "btn-primary py-1" : "btn-secondary py-1"}>{f.replace("_", " ")}</Link>)}</div>
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>#</th><th>Subject</th><th>Customer</th><th>Priority</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>{rows.map((t) => <tr key={t.id}><td>#{t.number}</td><td><Link className="font-medium text-brand-700" href={`/admin/tickets/${t.id}`}>{t.subject}</Link></td><td>{t.customer}</td><td><Badge value={t.priority} /></td><td><Badge value={t.status} /></td><td>{fmtDateTime(t.updatedAt)}</td></tr>)}
        {!rows.length && <tr><td colSpan={6} className="muted">No tickets.</td></tr>}</tbody></table></div>
    </div>
  );
}
