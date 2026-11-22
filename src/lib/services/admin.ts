import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { invalidatePrices } from "@/lib/adapters/crm";
import { DomainError } from "./catalog";
import type { Actor } from "./orders";

export async function listCustomers(search = "", limit = 100) {
  const q = search.trim().slice(0, 100);
  return db().select({
    id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role,
    disabled: schema.users.disabled, createdAt: schema.users.createdAt, crmId: schema.users.crmCustomerId,
    services: sql<number>`(select count(*)::int from subscriptions s where s.user_id = ${schema.users.id} and s.status <> 'cancelled')`,
  }).from(schema.users)
    .where(q ? sql`(${schema.users.email} ilike ${"%" + escapeLike(q) + "%"} or ${schema.users.name} ilike ${"%" + escapeLike(q) + "%"})` : undefined)
    .orderBy(desc(schema.users.createdAt)).limit(limit);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listSubscriptions(limit = 200) {
  return db().select({
    id: schema.subscriptions.id, status: schema.subscriptions.status, cycle: schema.subscriptions.cycle,
    price: schema.subscriptions.pricePerCycleFils, periodEnd: schema.subscriptions.currentPeriodEnd,
    ref: schema.subscriptions.externalRef, email: schema.users.email, product: schema.products.name, plan: schema.plans.name,
  }).from(schema.subscriptions)
    .innerJoin(schema.users, eq(schema.users.id, schema.subscriptions.userId))
    .innerJoin(schema.products, eq(schema.products.id, schema.subscriptions.productId))
    .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .orderBy(desc(schema.subscriptions.createdAt)).limit(limit);
}

export async function catalogForAdmin() {
  const [products, plans, addons, prices] = await Promise.all([
    db().select().from(schema.products).orderBy(schema.products.sort),
    db().select().from(schema.plans).orderBy(schema.plans.tier),
    db().select().from(schema.addons).orderBy(schema.addons.name),
    db().select().from(schema.crmPriceBook),
  ]);
  const price = new Map(prices.map((p) => [p.code, p.monthlyFils]));
  return products.map((p) => ({
    ...p,
    plans: plans.filter((x) => x.productId === p.id).map((x) => ({ ...x, monthlyFils: price.get(x.crmPriceCode) ?? null })),
    addons: addons.filter((x) => x.productId === p.id).map((x) => ({ ...x, monthlyFils: price.get(x.crmPriceCode) ?? null })),
  }));
}

export async function updatePlan(actor: Actor, input: { id: string; name: string; active: boolean; specs: Record<string, string>; monthlyFils: number }) {
  await db().transaction(async (tx) => {
    const [plan] = await tx.update(schema.plans).set({ name: input.name, active: input.active, specs: input.specs })
      .where(eq(schema.plans.id, input.id)).returning();
    if (!plan) throw new DomainError("Plan not found");
    await tx.insert(schema.crmPriceBook).values({ code: plan.crmPriceCode, monthlyFils: input.monthlyFils })
      .onConflictDoUpdate({ target: schema.crmPriceBook.code, set: { monthlyFils: input.monthlyFils, updatedAt: new Date() } });
    await audit({ actorId: actor.userId, ip: actor.ip, action: "catalog.plan_updated", entity: "plan", entityId: plan.id,
      data: { name: input.name, active: input.active, monthlyFils: input.monthlyFils } }, tx);
    invalidatePrices(plan.crmPriceCode);
  });
}

export async function createPlan(actor: Actor, input: { productId: string; code: string; name: string; tier: number; specs: Record<string, string>; monthlyFils: number }) {
  await db().transaction(async (tx) => {
    const crmPriceCode = `PB-${input.code}`;
    await tx.insert(schema.crmPriceBook).values({ code: crmPriceCode, monthlyFils: input.monthlyFils })
      .onConflictDoUpdate({ target: schema.crmPriceBook.code, set: { monthlyFils: input.monthlyFils, updatedAt: new Date() } });
    const [plan] = await tx.insert(schema.plans).values({ ...input, crmPriceCode }).onConflictDoNothing({ target: schema.plans.code }).returning();
    if (!plan) throw new DomainError("A plan with this code already exists");
    await audit({ actorId: actor.userId, ip: actor.ip, action: "catalog.plan_created", entity: "plan", entityId: plan.id, data: { code: input.code } }, tx);
  });
}

export async function updateAddon(actor: Actor, input: { id: string; name: string; active: boolean; monthlyFils: number }) {
  await db().transaction(async (tx) => {
    const [a] = await tx.update(schema.addons).set({ name: input.name, active: input.active }).where(eq(schema.addons.id, input.id)).returning();
    if (!a) throw new DomainError("Add-on not found");
    await tx.insert(schema.crmPriceBook).values({ code: a.crmPriceCode, monthlyFils: input.monthlyFils })
      .onConflictDoUpdate({ target: schema.crmPriceBook.code, set: { monthlyFils: input.monthlyFils, updatedAt: new Date() } });
    await audit({ actorId: actor.userId, ip: actor.ip, action: "catalog.addon_updated", entity: "addon", entityId: a.id, data: input }, tx);
    invalidatePrices(a.crmPriceCode);
  });
}

export async function updateProduct(actor: Actor, input: { id: string; name: string; tagline: string; description: string; active: boolean; options: Record<string, string[]> }) {
  const res = await db().update(schema.products).set({
    name: input.name, tagline: input.tagline, description: input.description, active: input.active, options: input.options,
  }).where(eq(schema.products.id, input.id)).returning({ id: schema.products.id });
  if (!res.length) throw new DomainError("Product not found");
  await audit({ actorId: actor.userId, ip: actor.ip, action: "catalog.product_updated", entity: "product", entityId: input.id, data: { name: input.name, active: input.active } });
}

export async function createCoupon(actor: Actor, input: { code: string; kind: "percent" | "fixed"; value: number; maxRedemptions: number | null; validUntil: Date | null }) {
  const exists = await db().select({ id: schema.coupons.id }).from(schema.coupons).where(sql`upper(${schema.coupons.code}) = upper(${input.code})`);
  if (exists.length) throw new DomainError("Coupon code already exists");
  const [c] = await db().insert(schema.coupons).values(input).returning();
  await audit({ actorId: actor.userId, ip: actor.ip, action: "coupon.created", entity: "coupon", entityId: c!.id, data: { code: input.code, kind: input.kind, value: input.value } });
}

export async function setCouponActive(actor: Actor, id: string, active: boolean) {
  await db().update(schema.coupons).set({ active }).where(eq(schema.coupons.id, id));
  await audit({ actorId: actor.userId, ip: actor.ip, action: "coupon.toggled", entity: "coupon", entityId: id, data: { active } });
}

export async function getContent(): Promise<Record<string, string>> {
  const rows = await db().select().from(schema.siteContent);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setContent(actor: Actor, values: Record<string, string>) {
  await db().transaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx.insert(schema.siteContent).values({ key, value })
        .onConflictDoUpdate({ target: schema.siteContent.key, set: { value, updatedAt: new Date() } });
    }
    await audit({ actorId: actor.userId, ip: actor.ip, action: "content.updated", entity: "site_content", data: { keys: Object.keys(values) } }, tx);
  });
}

export async function recentAudit(limit = 200) {
  return db().select({
    id: schema.auditLog.id, action: schema.auditLog.action, entity: schema.auditLog.entity, entityId: schema.auditLog.entityId,
    data: schema.auditLog.data, ip: schema.auditLog.ip, createdAt: schema.auditLog.createdAt,
    actor: sql<string | null>`(select email from users u where u.id = ${schema.auditLog.actorId})`,
    impersonator: sql<string | null>`(select email from users u where u.id = ${schema.auditLog.impersonatorId})`,
  }).from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(limit);
}

export async function recentJobs(limit = 100) {
  return db().select().from(schema.jobs).orderBy(desc(schema.jobs.createdAt)).limit(limit);
}

export async function retryJob(actor: Actor, id: string) {
  await db().update(schema.jobs).set({ status: "pending", nextRunAt: new Date(), attempts: 0, lastError: null })
    .where(eq(schema.jobs.id, id));
  await audit({ actorId: actor.userId, ip: actor.ip, action: "job.retried", entity: "job", entityId: id });
}
