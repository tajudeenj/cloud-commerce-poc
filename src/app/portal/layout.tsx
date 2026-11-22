import Link from "next/link";
import { requireUser } from "@/lib/auth";

export const metadata = { robots: { index: false } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  return (
    <div className="grid gap-8 md:grid-cols-[200px_1fr]">
      <aside>
        <p className="mb-3 text-sm text-ink-500">Signed in as<br /><b className="text-ink-900">{u.name}</b></p>
        <nav className="flex flex-col gap-1 text-sm font-medium" aria-label="Account">
          {[["/portal", "My services"], ["/portal/billing", "Billing & invoices"], ["/portal/tickets", "Support tickets"]].map(([h, l]) => (
            <Link key={h} href={h!} className="rounded-lg px-3 py-2 hover:bg-white hover:shadow-sm">{l}</Link>
          ))}
          <Link href="/#products" className="mt-3 btn-primary">+ New service</Link>
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
