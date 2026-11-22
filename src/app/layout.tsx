import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { logoutAction, stopImpersonationAction } from "./(auth)/actions";
import "./globals.css";

const brand = process.env.BRAND_NAME ?? "Umniah Cloud";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: { default: `${brand} — VPS, Business Email & DNS in Jordan`, template: `%s | ${brand}` },
  description: "Deploy cloud VPS, business email and managed DNS hosted in Jordan. Transparent JOD pricing, local support.",
  openGraph: { type: "website", siteName: brand },
  alternates: { canonical: "/" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const name = env().BRAND_NAME;
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-ink-900 antialiased">
        {user?.impersonatorId && (
          <div className="bg-amber-500 text-sm text-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2">
              <span>Support mode: <b>{user.impersonatorName}</b> is signed in as <b>{user.email}</b>. All actions are audited.</span>
              <form action={stopImpersonationAction}><button className="rounded bg-white/20 px-3 py-1 font-semibold hover:bg-white/30">Return to admin</button></form>
            </div>
          </div>
        )}
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3" aria-label="Main">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">☁</span>{name}
            </Link>
            <div className="flex items-center gap-5 text-sm font-medium text-ink-700">
              <Link href="/products/vps" className="hover:text-brand-700">VPS</Link>
              <Link href="/products/email" className="hover:text-brand-700">Email</Link>
              <Link href="/products/dns" className="hover:text-brand-700">DNS</Link>
              {user ? (
                <>
                  {user.role === "admin" && <Link href="/admin" className="hover:text-brand-700">Admin</Link>}
                  <Link href="/portal" className="btn-secondary">My account</Link>
                  <form action={logoutAction}><button className="text-ink-500 hover:text-ink-900">Sign out</button></form>
                </>
              ) : (
                <>
                  <Link href="/login" className="hover:text-brand-700">Sign in</Link>
                  <Link href="/register" className="btn-primary">Get started</Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-xs text-ink-500">
            <span>© {new Date().getFullYear()} {name}. Hosted in Jordan.</span>
            <span>Proof of concept — Cloud eCommerce Platform</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
