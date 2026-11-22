import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listTickets } from "@/lib/services/tickets";
import { Badge, fmtDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Tickets() {
  const u = await requireUser();
  const tickets = await listTickets({ userId: u.id });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="h1">Support tickets</h1><Link href="/portal/tickets/new" className="btn-primary">New ticket</Link></div>
      <div className="card overflow-x-auto p-0">
        <table className="table"><thead><tr><th>#</th><th>Subject</th><th>Priority</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>{tickets.map((t) => (<tr key={t.id}><td>#{t.number}</td><td><Link className="font-medium text-brand-700" href={`/portal/tickets/${t.id}`}>{t.subject}</Link></td><td><Badge value={t.priority} /></td><td><Badge value={t.status} /></td><td>{fmtDateTime(t.updatedAt)}</td></tr>))}
          {!tickets.length && <tr><td colSpan={5} className="muted">No tickets yet.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
