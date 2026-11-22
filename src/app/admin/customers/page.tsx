import { requireAdmin } from "@/lib/auth";
import { listCustomers } from "@/lib/services/admin";
import { fmtDate } from "@/components/ui";
import { impersonateAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const { q = "" } = await searchParams;
  const rows = await listCustomers(q);
  return (
    <div className="space-y-6">
      <h1 className="h1">Customers</h1>
      <form className="flex max-w-md gap-2"><input name="q" defaultValue={q} className="input" placeholder="Search name or email" /><button className="btn-secondary">Search</button></form>
      <div className="card overflow-x-auto p-0">
        <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>CRM ID</th><th>Services</th><th>Joined</th><th>Login as client</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.name}</td><td>{r.email}</td><td>{r.role}</td><td className="font-mono text-xs">{r.crmId ?? "—"}</td><td>{r.services}</td><td>{fmtDate(r.createdAt)}</td>
              <td>{r.role === "customer" && (
                <form action={impersonateAction} className="flex gap-1">
                  <input type="hidden" name="userId" value={r.id} />
                  <input name="reason" className="input py-1 text-xs" placeholder="Reason (audited)" required minLength={5} maxLength={200} />
                  <button className="btn-secondary py-1 text-xs">Login as</button>
                </form>)}</td></tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}
