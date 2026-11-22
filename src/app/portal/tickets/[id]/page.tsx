import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getTicket } from "@/lib/services/tickets";
import { Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/form";
import { TicketThread } from "@/components/ticket-thread";
import { closeTicketAction, replyTicketAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTicket(id, { userId: u.id, isStaff: false });
  if (!t) notFound();
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/portal/tickets" className="muted hover:underline">← Tickets</Link>
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="h1">#{t.number} · {t.subject}</h1><div className="flex gap-2"><Badge value={t.priority} /><Badge value={t.status} /></div></div>
      <TicketThread messages={t.messages} />
      <ActionForm action={replyTicketAction} className="card space-y-3">
        <input type="hidden" name="ticketId" value={t.id} />
        <label className="label" htmlFor="body">{t.status === "closed" ? "Reply to reopen this ticket" : "Add a reply"}</label>
        <textarea id="body" name="body" className="input min-h-28" required maxLength={10000} />
        <Submit>Send</Submit>
      </ActionForm>
      {t.status !== "closed" && <form action={closeTicketAction}><input type="hidden" name="ticketId" value={t.id} /><button className="btn-secondary">Mark as resolved</button></form>}
    </div>
  );
}
