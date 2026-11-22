import { formatJod } from "@/lib/billing-math";

export function Money({ fils, className }: { fils: number; className?: string }) {
  return <span className={className}>{formatJod(fils)}</span>;
}

const TONES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  answered: "bg-sky-50 text-sky-700 ring-sky-200",
  provisioning: "bg-sky-50 text-sky-700 ring-sky-200",
  running: "bg-sky-50 text-sky-700 ring-sky-200",
  open: "bg-amber-50 text-amber-800 ring-amber-200",
  customer_reply: "bg-amber-50 text-amber-800 ring-amber-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  cancel_pending: "bg-amber-50 text-amber-800 ring-amber-200",
  high: "bg-amber-50 text-amber-800 ring-amber-200",
  critical: "bg-red-50 text-red-700 ring-red-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  suspended: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({ value }: { value: string }) {
  const tone = TONES[value] ?? "bg-slate-50 text-slate-700 ring-slate-200";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>{value.replace(/_/g, " ")}</span>;
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: React.ReactNode }) {
  const tone = kind === "error" ? "border-red-200 bg-red-50 text-red-800" : kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-800";
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>{children}</div>;
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Amman" }) : "—";
export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Amman" }) : "—";
