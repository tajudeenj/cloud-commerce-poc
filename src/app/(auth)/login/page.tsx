import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "" } = await searchParams;
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="card">
        <h1 className="h1 mb-1">Sign in</h1>
        <p className="muted mb-6">Manage your cloud services, billing and support.</p>
        <ActionForm action={loginAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
          <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <Submit className="btn-primary w-full">Sign in</Submit>
        </ActionForm>
        <p className="muted mt-4">New here? <Link className="font-semibold text-brand-700" href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link></p>
        <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-ink-500">
          <p className="font-semibold">POC demo accounts</p>
          <p>Customer: customer@demo.jo / Customer#2026!</p>
          <p>Admin: admin@cloud.local / Admin#2026!</p>
        </div>
      </div>
    </div>
  );
}
