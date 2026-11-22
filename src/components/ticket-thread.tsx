import { fmtDateTime } from "./ui";

export function TicketThread({ messages }: { messages: { id: string; body: string; isStaff: boolean; author: string; createdAt: Date }[] }) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className={`rounded-xl border p-4 ${m.isStaff ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"}`}>
          <p className="mb-2 text-xs text-ink-500"><b className="text-ink-900">{m.author}</b>{m.isStaff && " · Support team"} · {fmtDateTime(m.createdAt)}</p>
          {/* Rendered as text — React escapes it, so user input can never inject markup. */}
          <p className="whitespace-pre-wrap text-sm">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
