import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const metadata = { robots: { index: false } };

const NAV = [
  ["/admin", "Dashboard"], ["/admin/customers", "Customers"], ["/admin/subscriptions", "Subscriptions"], ["/admin/tickets", "Tickets"],
  ["/admin/catalog", "Products & pricing"], ["/admin/coupons", "Coupons"], ["/admin/content", "Site content"], ["/admin/jobs", "Jobs & billing"], ["/admin/audit", "Audit trail"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="grid gap-8 md:grid-cols-[200px_1fr]">
      <aside><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Cloud team admin</p>
        <nav className="flex flex-col gap-1 text-sm font-medium" aria-label="Admin">
          {NAV.map(([h, l]) => <Link key={h} href={h!} className="rounded-lg px-3 py-2 hover:bg-white hover:shadow-sm">{l}</Link>)}
        </nav></aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
