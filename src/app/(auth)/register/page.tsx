import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { registerAction } from "../actions";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "" } = await searchParams;
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="card">
        <h1 className="h1 mb-1">Create your account</h1>
        <p className="muted mb-6">One account for all your cloud services.</p>
        <ActionForm action={registerAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div><label className="label" htmlFor="name">Full name</label><input className="input" id="name" name="name" autoComplete="name" required maxLength={100} /></div>
          <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
          <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
            <p className="muted mt-1 text-xs">At least 10 characters with upper, lower case and a number.</p></div>
          <Submit className="btn-primary w-full">Create account</Submit>
        </ActionForm>
        <p className="muted mt-4">Already registered? <Link className="font-semibold text-brand-700" href="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
