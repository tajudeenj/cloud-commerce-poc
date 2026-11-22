import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { payments, type PaymentResult } from "@/lib/adapters/payment";
import { crm } from "@/lib/adapters/crm";
import { periodEnd, prorate, type Cycle } from "@/lib/billing-math";
import { DomainError, quote, type QuoteInput } from "./catalog";
import { track } from "./analytics";

export type Actor = { userId: string; impersonatorId?: string | null; ip?: string | null };

/**
 * Creates (or returns, if the idempotency key was already used) a pending order and the gateway URL.
 * Double-clicks / retries never create duplicate orders.
 */
export async function startCheckout(actor: Actor, input: QuoteInput, idempotencyKey: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(idempotencyKey)) throw new DomainError("Invalid request token");
  const existing = await db().query.orders.findFirst({ where: eq(schema.orders.idempotencyKey, idempotencyKey) });
  if (existing) {
    if (existing.userId !== actor.userId) throw new DomainError("Invalid request token");
    return { orderId: existing.id, redirectUrl: gatewayUrl(existing.id, existing.totalFils, existing.status) };
  }
  const q = await quote(input);
  const [order] = await db().insert(schema.orders).values({
    userId: actor.userId, kind: "new", productId: q.productId, planId: q.planId, cycle: q.cycle,
    addonCodes: q.addonCodes, config: q.config, lines: q.lines, subtotalFils: q.subtotalFils,
    discountFils: q.discountFils, totalFils: q.totalFils, couponId: q.couponId, idempotencyKey,
  }).onConflictDoNothing({ target: schema.orders.idempotencyKey }).returning();
  if (!order) return startCheckout(actor, input, idempotencyKey); // lost a race with a concurrent identical submit
  await track({ userId: actor.userId, visitorId: actor.userId, type: "checkout_started", data: { orderId: order.id, product: input.productSlug, total: q.totalFils } });
  await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip, action: "order.created", entity: "order", entityId: order.id, data: { total: q.totalFils, kind: "new" } });
  return { orderId: order.id, redirectUrl: gatewayUrl(order.id, order.totalFils, order.status) };
}

function gatewayUrl(orderId: string, totalFils: number, status: string) {
  if (status !== "pending") return `/checkout/result?order=${orderId}`;
  return payments().hostedPaymentUrl({ orderId, amountFils: totalFils, description: `Order ${orderId.slice(0, 8)}` });
}

/**
 * Applies a verified gateway result. Idempotent and race-safe: the order row is locked, and a paid order
 * is never fulfilled twice even if the gateway redirects and calls back concurrently.
 */
export async function completePayment(result: PaymentResult): Promise<{ orderId: string; status: "paid" | "failed"; subscriptionId: string | null }> {
  return db().transaction(async (tx) => {
    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, result.orderId)).for("update");
    if (!order) throw new DomainError("Order not found");
    if (order.status === "paid") return { orderId: order.id, status: "paid", subscriptionId: order.subscriptionId };
    if (order.status !== "pending") return { orderId: order.id, status: "failed", subscriptionId: order.subscriptionId };

    if (result.status !== "success" || result.amountFils !== order.totalFils) {
      await tx.update(schema.orders).set({ status: "failed", gatewayRef: result.txnRef }).where(eq(schema.orders.id, order.id));
      await audit({ actorId: order.userId, action: "payment.failed", entity: "order", entityId: order.id,
        data: { reason: result.status !== "success" ? "declined" : "amount_mismatch", amount: result.amountFils } }, tx);
      return { orderId: order.id, status: "failed", subscriptionId: order.subscriptionId };
    }

    const now = new Date();
    let subscriptionId = order.subscriptionId;
    if (order.kind === "new") {
      const [sub] = await tx.insert(schema.subscriptions).values({
        userId: order.userId, productId: order.productId, planId: order.planId, cycle: order.cycle,
        addonCodes: order.addonCodes, config: order.config, status: "provisioning",
        pricePerCycleFils: order.subtotalFils, currentPeriodStart: now, currentPeriodEnd: periodEnd(now, order.cycle),
      }).returning();
      subscriptionId = sub!.id;
      await tx.insert(schema.jobs).values({ kind: "provision", subscriptionId });
    } else if (order.kind === "upgrade") {
      if (!subscriptionId) throw new DomainError("Upgrade order missing subscription");
      if (order.newCyclePriceFils === null) throw new DomainError("Upgrade order missing new cycle price");
      const newCyclePrice = order.newCyclePriceFils;
      await tx.update(schema.subscriptions).set({
        planId: order.planId, addonCodes: order.addonCodes, pricePerCycleFils: newCyclePrice, pendingPlanId: null,
      }).where(eq(schema.subscriptions.id, subscriptionId));
      await tx.insert(schema.jobs).values({ kind: "modify", subscriptionId });
    }

    if (order.couponId) {
      // Guarded increment: never exceeds max redemptions even under concurrency.
      await tx.update(schema.coupons).set({ redeemed: sql`${schema.coupons.redeemed} + 1` }).where(and(
        eq(schema.coupons.id, order.couponId),
        or(isNull(schema.coupons.maxRedemptions), lt(schema.coupons.redeemed, schema.coupons.maxRedemptions)),
      ));
    }

    const [invoice] = await tx.insert(schema.invoices).values({
      userId: order.userId, subscriptionId, orderId: order.id, lines: order.lines,
      subtotalFils: order.subtotalFils, discountFils: order.discountFils, totalFils: order.totalFils,
    }).returning();
    await tx.insert(schema.payments).values({
      userId: order.userId, orderId: order.id, invoiceId: invoice!.id, gatewayRef: result.txnRef,
      amountFils: result.amountFils, method: result.method ?? "card", status: "captured",
    }).onConflictDoNothing({ target: schema.payments.gatewayRef });
    await tx.update(schema.orders).set({ status: "paid", paidAt: now, gatewayRef: result.txnRef, subscriptionId })
      .where(eq(schema.orders.id, order.id));
    if (result.token) await tx.update(schema.users).set({ paymentToken: result.token }).where(eq(schema.users.id, order.userId));

    await audit({ actorId: order.userId, action: "payment.captured", entity: "order", entityId: order.id,
      data: { amount: result.amountFils, kind: order.kind, invoice: invoice!.number } }, tx);
    await tx.insert(schema.events).values({ userId: order.userId, visitorId: order.userId, type: "purchased",
      data: { orderId: order.id, total: order.totalFils, kind: order.kind } });
    return { orderId: order.id, status: "paid", subscriptionId };
  });
}

/** Ensures the customer exists in CRM (best-effort, outside the payment transaction). */
export async function syncCustomerToCrm(userId: string) {
  const u = await db().query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u || u.crmCustomerId) return;
  const crmId = await crm().upsertCustomer({ id: u.id, email: u.email, name: u.name });
  await db().update(schema.users).set({ crmCustomerId: crmId }).where(eq(schema.users.id, u.id));
}

// ---------------- Subscription self-service ----------------

async function ownedSub(actor: Actor, subscriptionId: string, tx?: Tx) {
  const s = await (tx ?? db()).query.subscriptions.findFirst({
    where: and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.userId, actor.userId)),
  });
  if (!s) throw new DomainError("Subscription not found", "not_found");
  return s;
}

export async function previewPlanChange(actor: Actor, subscriptionId: string, planCode: string, addonCodes: string[]) {
  const sub = await ownedSub(actor, subscriptionId);
  if (sub.status !== "active") throw new DomainError("Only active services can be changed");
  const product = await db().query.products.findFirst({ where: eq(schema.products.id, sub.productId) });
  const q = await quote({ productSlug: product!.slug, planCode, cycle: sub.cycle as Cycle, addonCodes, config: sub.config });
  const charge = prorate({
    oldCycleFils: sub.pricePerCycleFils, newCycleFils: q.subtotalFils,
    periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, now: new Date(),
  });
  return { sub, quote: q, chargeFils: charge, mode: charge > 0 ? ("upgrade_now" as const) : ("change_at_renewal" as const) };
}

export async function changePlan(actor: Actor, subscriptionId: string, planCode: string, addonCodes: string[], idempotencyKey: string) {
  const p = await previewPlanChange(actor, subscriptionId, planCode, addonCodes);
  if (p.quote.planId === p.sub.planId && sameSet(p.quote.addonCodes, p.sub.addonCodes)) throw new DomainError("No change selected");
  if (p.mode === "change_at_renewal") {
    await db().update(schema.subscriptions).set({ pendingPlanId: p.quote.planId }).where(eq(schema.subscriptions.id, p.sub.id));
    await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip, action: "subscription.downgrade_scheduled",
      entity: "subscription", entityId: p.sub.id, data: { toPlan: planCode } });
    return { redirectUrl: `/portal/services/${p.sub.id}?msg=change-scheduled` };
  }
  const existing = await db().query.orders.findFirst({ where: eq(schema.orders.idempotencyKey, idempotencyKey) });
  if (existing) return { redirectUrl: gatewayUrl(existing.id, existing.totalFils, existing.status) };
  const [order] = await db().insert(schema.orders).values({
    userId: actor.userId, kind: "upgrade", productId: p.sub.productId, planId: p.quote.planId, subscriptionId: p.sub.id,
    cycle: p.sub.cycle, addonCodes: p.quote.addonCodes,
    config: p.sub.config, newCyclePriceFils: p.quote.subtotalFils,
    lines: [{ code: planCode, description: `Prorated upgrade to ${p.quote.planName} (remaining period)`, amountFils: p.chargeFils }],
    subtotalFils: p.chargeFils, totalFils: p.chargeFils, idempotencyKey,
  }).returning();
  await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip, action: "order.created",
    entity: "order", entityId: order!.id, data: { kind: "upgrade", total: p.chargeFils } });
  return { redirectUrl: gatewayUrl(order!.id, order!.totalFils, order!.status) };
}

export async function setCancellation(actor: Actor, subscriptionId: string, cancel: boolean) {
  const sub = await ownedSub(actor, subscriptionId);
  if (cancel && sub.status !== "active") throw new DomainError("Only active services can be cancelled");
  if (!cancel && sub.status !== "cancel_pending") throw new DomainError("Service is not pending cancellation");
  await db().update(schema.subscriptions).set({ status: cancel ? "cancel_pending" : "active" })
    .where(eq(schema.subscriptions.id, sub.id));
  await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip,
    action: cancel ? "subscription.cancel_requested" : "subscription.cancel_reverted", entity: "subscription", entityId: sub.id });
}

export async function setAutoRenew(actor: Actor, subscriptionId: string, autoRenew: boolean) {
  const sub = await ownedSub(actor, subscriptionId);
  await db().update(schema.subscriptions).set({ autoRenew }).where(eq(schema.subscriptions.id, sub.id));
  await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip,
    action: "subscription.auto_renew", entity: "subscription", entityId: sub.id, data: { autoRenew } });
}

/** Expires stale pending orders (abandoned at the gateway) so analytics and order lists stay accurate. */
export async function expireStaleOrders(olderThanMinutes = 60) {
  await db().update(schema.orders).set({ status: "cancelled" }).where(and(
    eq(schema.orders.status, "pending"),
    lt(schema.orders.createdAt, new Date(Date.now() - olderThanMinutes * 60_000)),
  ));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
