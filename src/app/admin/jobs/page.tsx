import { requireAdmin } from "@/lib/auth";
import { recentJobs } from "@/lib/services/admin";
import { ActionForm, Submit } from "@/components/form";
import { Badge, fmtDateTime } from "@/components/ui";
import { retryJobAction, runBillingNowAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Jobs() {
  await requireAdmin();
  const rows = await recentJobs();
  return (
    <div className="space-y-6"><h1 className="h1">Jobs & billing</h1>
      <ActionForm action={runBillingNowAction} className="card flex flex-wrap items-center justify-between gap-3">
        <p className="muted">The worker runs automatically (provisioning every few seconds, renewals every minute). Trigger a run now for demos:</p>
        <Submit>Run billing cycle now</Submit>
      </ActionForm>
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Created</th><th>Kind</th><th>Status</th><th>Attempts</th><th>Next run</th><th>Last error</th><th></th></tr></thead>
        <tbody>{rows.map((j) => (<tr key={j.id}><td>{fmtDateTime(j.createdAt)}</td><td>{j.kind}</td><td><Badge value={j.status} /></td><td>{j.attempts}/{j.maxAttempts}</td><td>{fmtDateTime(j.nextRunAt)}</td><td className="max-w-xs truncate text-xs text-red-700" title={j.lastError ?? ""}>{j.lastError}</td>
          <td>{j.status === "failed" && <form action={retryJobAction}><input type="hidden" name="id" value={j.id} /><button className="btn-secondary py-1 text-xs">Retry</button></form>}</td></tr>))}</tbody></table></div>
    </div>
  );
}
