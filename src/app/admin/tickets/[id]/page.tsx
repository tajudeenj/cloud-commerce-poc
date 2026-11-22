import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getTicket } from "@/lib/services/tickets";
import { Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/form";
import { TicketThread } from "@/components/ticket-thread";
import { staffCloseAction, staffReplyAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTicket(id, { userId: u.id, isStaff: true });
  if (!t) notFound();
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/admin/tickets" className="muted hover:underline">← All tickets</Link>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="h1">#{t.number} · {t.subject}</h1><p className="muted">{t.customer?.name} — {t.customer?.email}</p></div><div className="flex gap-2"><Badge value={t.priority} /><Badge value={t.status} /></div></div>
      <TicketThread messages={t.messages} />
      <ActionForm action={staffReplyAction} className="card space-y-3">
        <input type="hidden" name="ticketId" value={t.id} />
        <label className="label" htmlFor="body">Reply to customer</label>
        <textarea id="body" name="body" className="input min-h-28" required maxLength={10000} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="close" className="accent-brand-600" /> Close ticket after replying</label>
        <Submit>Send reply</Submit>
      </ActionForm>
      {t.status !== "closed" && <form action={staffCloseAction}><input type="hidden" name="ticketId" value={t.id} /><button className="btn-secondary">Close without reply</button></form>}
    </div>
  );
}
