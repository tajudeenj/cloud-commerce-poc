"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, createSession, destroySession, requireAdmin } from "@/lib/auth";
import { runAction, str, uuid, type FormState } from "@/lib/action";
import * as admin from "@/lib/services/admin";
import { closeTicket, replyTicket } from "@/lib/services/tickets";
import { runJobsOnce, runRenewals } from "@/lib/services/worker";

async function actor() {
  const u = await requireAdmin();
  return { u, a: { userId: u.id, ip: await clientIp() } };
}

const jod = z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/, "Enter a price like 12.500").transform((v) => Math.round(Number(v) * 1000));
const specsSchema = z.string().max(2000).transform((s, ctx) => {
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf(":");
    if (i < 1) { ctx.addIssue({ code: "custom", message: `Spec lines must be "Name: value" — got "${line.slice(0, 30)}"` }); return z.NEVER; }
    out[line.slice(0, i).trim().slice(0, 40)] = line.slice(i + 1).trim().slice(0, 80);
  }
  return out;
});
const list = z.string().max(2000).transform((s) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean).slice(0, 30));

export async function impersonateAction(fd: FormData) {
  const { u, a } = await actor();
  const target = uuid.parse(str(fd, "userId"));
  const reason = z.string().trim().min(5).max(200).catch("Customer support").parse(str(fd, "reason"));
  const customer = await db().query.users.findFirst({ where: and(eq(schema.users.id, target), eq(schema.users.role, "customer")) });
  if (!customer) throw new Error("Only customer accounts can be impersonated");
  await audit({ actorId: u.id, ip: a.ip, action: "auth.impersonation_started", entity: "user", entityId: customer.id, data: { reason, customer: customer.email } });
  await destroySession();
  await createSession(customer.id, u.id);
  redirect("/portal");
}

export async function updatePlanAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const input = z.object({ id: uuid, name: z.string().trim().min(2).max(80), active: z.boolean(), specs: specsSchema, monthlyFils: jod })
      .parse({ id: str(fd, "id"), name: str(fd, "name"), active: fd.get("active") === "on", specs: str(fd, "specs"), monthlyFils: str(fd, "price") });
    await admin.updatePlan(a, input);
    revalidatePath("/admin/catalog");
    return { ok: "Plan saved. New price is live immediately." };
  });
}

export async function createPlanAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const input = z.object({
      productId: uuid, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,30}$/, "Code: letters, digits, dashes"),
      name: z.string().trim().min(2).max(80), tier: z.coerce.number().int().min(0).max(100), specs: specsSchema, monthlyFils: jod,
    }).parse({ productId: str(fd, "productId"), code: str(fd, "code"), name: str(fd, "name"), tier: str(fd, "tier"), specs: str(fd, "specs"), monthlyFils: str(fd, "price") });
    await admin.createPlan(a, input);
    revalidatePath("/admin/catalog");
    return { ok: `Plan ${input.code} created and available for sale.` };
  });
}

export async function updateAddonAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const input = z.object({ id: uuid, name: z.string().trim().min(2).max(80), active: z.boolean(), monthlyFils: jod })
      .parse({ id: str(fd, "id"), name: str(fd, "name"), active: fd.get("active") === "on", monthlyFils: str(fd, "price") });
    await admin.updateAddon(a, input);
    revalidatePath("/admin/catalog");
    return { ok: "Add-on saved." };
  });
}

export async function updateProductAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const input = z.object({
      id: uuid, name: z.string().trim().min(2).max(80), tagline: z.string().trim().max(160), description: z.string().trim().max(2000),
      active: z.boolean(), regions: list, os: list,
    }).parse({ id: str(fd, "id"), name: str(fd, "name"), tagline: str(fd, "tagline"), description: str(fd, "description"), active: fd.get("active") === "on", regions: str(fd, "regions"), os: str(fd, "os") });
    const options: Record<string, string[]> = {};
    if (input.regions.length) options.regions = input.regions;
    if (input.os.length) options.os = input.os;
    await admin.updateProduct(a, { ...input, options });
    revalidatePath("/admin/catalog");
    return { ok: "Product saved." };
  });
}

export async function createCouponAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const kind = z.enum(["percent", "fixed"]).parse(str(fd, "kind"));
    const value = kind === "percent"
      ? z.coerce.number().int().min(1).max(100).parse(str(fd, "value"))
      : jod.parse(str(fd, "value"));
    const input = {
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "Code: 3–30 letters/digits").parse(str(fd, "code")),
      kind, value,
      maxRedemptions: str(fd, "max") ? z.coerce.number().int().min(1).max(1_000_000).parse(str(fd, "max")) : null,
      validUntil: str(fd, "until") ? z.coerce.date().parse(str(fd, "until")) : null,
    };
    await admin.createCoupon(a, input);
    revalidatePath("/admin/coupons");
    return { ok: `Coupon ${input.code} created.` };
  });
}

export async function toggleCouponAction(fd: FormData) {
  const { a } = await actor();
  await admin.setCouponActive(a, uuid.parse(str(fd, "id")), str(fd, "active") === "true");
  revalidatePath("/admin/coupons");
}

export async function saveContentAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const v = z.object({
      "hero.badge": z.string().trim().max(80), "hero.title": z.string().trim().min(5).max(120), "hero.subtitle": z.string().trim().max(400),
    }).parse({ "hero.badge": str(fd, "hero.badge"), "hero.title": str(fd, "hero.title"), "hero.subtitle": str(fd, "hero.subtitle") });
    await admin.setContent(a, v);
    revalidatePath("/");
    return { ok: "Homepage content published." };
  });
}

export async function staffReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const id = uuid.parse(str(fd, "ticketId"));
    await replyTicket({ ...a, isStaff: true }, id, z.string().trim().min(1).max(10_000).parse(str(fd, "body")));
    if (fd.get("close") === "on") await closeTicket({ ...a, isStaff: true }, id);
    revalidatePath(`/admin/tickets/${id}`);
    return { ok: "Reply sent to customer." };
  });
}

export async function staffCloseAction(fd: FormData) {
  const { a } = await actor();
  const id = uuid.parse(str(fd, "ticketId"));
  await closeTicket({ ...a, isStaff: true }, id);
  revalidatePath(`/admin/tickets/${id}`);
}

export async function runBillingNowAction(_: FormState): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const r = await runRenewals();
    const n = await runJobsOnce();
    await audit({ actorId: a.userId, ip: a.ip, action: "billing.manual_run", entity: "system", data: { ...r, jobs: n } });
    revalidatePath("/admin/jobs");
    return { ok: `Billing run: ${r.due} due, ${r.renewed} renewed, ${r.cancelled} cancelled, ${r.suspended} suspended; ${n} jobs processed.` };
  });
}

export async function retryJobAction(fd: FormData) {
  const { a } = await actor();
  await admin.retryJob(a, uuid.parse(str(fd, "id")));
  revalidatePath("/admin/jobs");
}
