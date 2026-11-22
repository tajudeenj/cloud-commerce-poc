import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { provisioning } from "@/lib/adapters/provisioning";
import { payments } from "@/lib/adapters/payment";
import { IntegrationError } from "@/lib/adapters/http";
import { getPrices } from "@/lib/adapters/crm";
import { CYCLE_LABEL, cyclePrice, periodEnd, type Cycle } from "@/lib/billing-math";
import { expireStaleOrders, syncCustomerToCrm } from "./orders";

const BATCH = 10;
const LEASE_MS = 2 * 60_000;

type Job = typeof schema.jobs.$inferSelect;

/**
 * Claims due jobs with FOR UPDATE SKIP LOCKED + a lease, so multiple app replicas can run the worker
 * safely and jobs held by a crashed process are reclaimed after the lease expires.
 */
async function claim(): Promise<Job[]> {
  const res = await db().execute<Record<string, unknown>>(sql`
    update jobs set status = 'running', attempts = attempts + 1, locked_until = now() + ${`${LEASE_MS} milliseconds`}::interval, updated_at = now()
    where id in (
      select id from jobs
      where (status = 'pending' and next_run_at <= now())
         or (status = 'running' and locked_until < now())
      order by next_run_at
      limit ${BATCH}
      for update skip locked
    )
    returning id`);
  const ids = res.rows.map((r) => String(r.id));
  if (!ids.length) return [];
  return db().select().from(schema.jobs).where(inArray(schema.jobs.id, ids));
}

async function finish(job: Job, error?: unknown) {
  if (!error) {
    await db().update(schema.jobs).set({ status: "done", lockedUntil: null, lastError: null, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id));
    return;
  }
  const msg = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const permanent = (error instanceof IntegrationError && !error.retryable) || job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(5_000 * 2 ** (job.attempts - 1), 15 * 60_000);
  await db().update(schema.jobs).set({
    status: permanent ? "failed" : "pending", lockedUntil: null, lastError: msg, updatedAt: new Date(),
    nextRunAt: new Date(Date.now() + backoffMs),
  }).where(eq(schema.jobs.id, job.id));
  if (permanent && job.subscriptionId && job.kind === "provision") {
    // Compensation: mark the service failed so support/finance can refund; the customer sees a clear status.
    await db().update(schema.subscriptions).set({ status: "failed" }).where(eq(schema.subscriptions.id, job.subscriptionId));
    await audit({ action: "provisioning.failed", entity: "subscription", entityId: job.subscriptionId, data: { error: msg } });
  }
}

async function runJob(job: Job) {
  if (!job.subscriptionId) return;
  const sub = await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, job.subscriptionId) });
  if (!sub) return;
  const [product, plan] = await Promise.all([
    db().query.products.findFirst({ where: eq(schema.products.id, sub.productId) }),
    db().query.plans.findFirst({ where: eq(schema.plans.id, sub.planId) }),
  ]);
  const req = { jobId: job.id, subscriptionId: sub.id, type: product!.provisioningType, planCode: plan!.code,
    addonCodes: sub.addonCodes, config: sub.config };

  if (job.kind === "provision") {
    if (sub.externalRef) return; // already provisioned (retry after a crash)
    const r = await provisioning().provision(req);
    await db().update(schema.subscriptions).set({ status: "active", externalRef: r.externalRef, serviceDetails: r.details })
      .where(eq(schema.subscriptions.id, sub.id));
    await audit({ action: "provisioning.completed", entity: "subscription", entityId: sub.id, data: { ref: r.externalRef } });
    await syncCustomerToCrm(sub.userId).catch((e) => console.warn("[crm] customer sync deferred", e.message));
  } else if (job.kind === "modify") {
    if (!sub.externalRef) throw new IntegrationError("Service not yet provisioned", undefined, true);
    const r = await provisioning().modify({ ...req, externalRef: sub.externalRef });
    await db().update(schema.subscriptions).set({ serviceDetails: r.details }).where(eq(schema.subscriptions.id, sub.id));
    await audit({ action: "provisioning.modified", entity: "subscription", entityId: sub.id });
  } else if (job.kind === "deprovision") {
    if (sub.externalRef) await provisioning().deprovision({ jobId: job.id, externalRef: sub.externalRef, type: product!.provisioningType });
    await audit({ action: "provisioning.deprovisioned", entity: "subscription", entityId: sub.id });
  }
}

/** Renews, cancels or suspends subscriptions whose period has ended. Each subscription is its own transaction. */
export async function runRenewals(now = new Date()) {
  const due = await db().select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(and(
    inArray(schema.subscriptions.status, ["active", "cancel_pending"]), lte(schema.subscriptions.currentPeriodEnd, now),
  )).limit(200);
  let renewed = 0, cancelled = 0, suspended = 0;
  for (const { id } of due) {
    const outcome = await renewOne(id, now).catch((e) => { console.error("[renewal]", id, e.message); return "error" as const; });
    if (outcome === "renewed") renewed++; else if (outcome === "cancelled") cancelled++; else if (outcome === "suspended") suspended++;
  }
  return { due: due.length, renewed, cancelled, suspended };
}

async function renewOne(subscriptionId: string, now: Date) {
  // Price lookup and the token charge happen before the DB transaction to keep locks short.
  const sub = await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) });
  if (!sub || sub.currentPeriodEnd > now) return "skipped";
  const user = await db().query.users.findFirst({ where: eq(schema.users.id, sub.userId) });

  if (sub.status === "cancel_pending" || !sub.autoRenew) {
    await db().transaction(async (tx) => {
      await tx.update(schema.subscriptions).set({ status: "cancelled", cancelledAt: now }).where(eq(schema.subscriptions.id, sub.id));
      await tx.insert(schema.jobs).values({ kind: "deprovision", subscriptionId: sub.id });
      await audit({ action: "subscription.cancelled", entity: "subscription", entityId: sub.id }, tx);
    });
    return "cancelled";
  }

  const planId = sub.pendingPlanId ?? sub.planId;
  const plan = await db().query.plans.findFirst({ where: eq(schema.plans.id, planId) });
  const addons = sub.addonCodes.length ? await db().select().from(schema.addons).where(inArray(schema.addons.code, sub.addonCodes)) : [];
  const prices = await getPrices([plan!.crmPriceCode, ...addons.map((a) => a.crmPriceCode)]);
  const cycle = sub.cycle as Cycle;
  const lines = [
    { code: plan!.code, description: `${plan!.name} renewal (${CYCLE_LABEL[cycle]})`, amountFils: cyclePrice(prices.get(plan!.crmPriceCode)!, cycle) },
    ...addons.map((a) => ({ code: a.code, description: `${a.name} renewal (${CYCLE_LABEL[cycle]})`, amountFils: cyclePrice(prices.get(a.crmPriceCode)!, cycle) })),
  ];
  const total = lines.reduce((s, l) => s + l.amountFils, 0);
  const reference = `renew-${sub.id}-${sub.currentPeriodEnd.getTime()}`; // idempotent per period
  const charge = user?.paymentToken ? await payments().chargeToken({ token: user.paymentToken, amountFils: total, reference }) : { ok: false, txnRef: "" };

  return db().transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id)).for("update");
    if (!locked || locked.currentPeriodEnd.getTime() !== sub.currentPeriodEnd.getTime()) return "skipped" as const;
    if (!charge.ok) {
      await tx.update(schema.subscriptions).set({ status: "suspended" }).where(eq(schema.subscriptions.id, sub.id));
      await audit({ action: "subscription.suspended", entity: "subscription", entityId: sub.id, data: { reason: "renewal_payment_failed", amount: total } }, tx);
      return "suspended" as const;
    }
    const [order] = await tx.insert(schema.orders).values({
      userId: sub.userId, kind: "renewal", status: "paid", productId: sub.productId, planId, subscriptionId: sub.id,
      cycle, addonCodes: sub.addonCodes, config: sub.config, lines, subtotalFils: total, totalFils: total,
      idempotencyKey: reference, gatewayRef: charge.txnRef, paidAt: now,
    }).onConflictDoNothing({ target: schema.orders.idempotencyKey }).returning();
    if (!order) return "skipped" as const;
    const [inv] = await tx.insert(schema.invoices).values({ userId: sub.userId, subscriptionId: sub.id, orderId: order.id, lines, subtotalFils: total, totalFils: total }).returning();
    await tx.insert(schema.payments).values({ userId: sub.userId, orderId: order.id, invoiceId: inv!.id, gatewayRef: charge.txnRef, amountFils: total, method: "card-on-file", status: "captured" });
    const start = sub.currentPeriodEnd;
    await tx.update(schema.subscriptions).set({
      planId, pendingPlanId: null, pricePerCycleFils: total, currentPeriodStart: start, currentPeriodEnd: periodEnd(start, cycle),
    }).where(eq(schema.subscriptions.id, sub.id));
    if (sub.pendingPlanId) await tx.insert(schema.jobs).values({ kind: "modify", subscriptionId: sub.id });
    await audit({ action: "subscription.renewed", entity: "subscription", entityId: sub.id, data: { amount: total, invoice: inv!.number } }, tx);
    return "renewed" as const;
  });
}

export async function runJobsOnce() {
  const batch = await claim();
  await Promise.all(batch.map(async (job) => {
    try { await runJob(job); await finish(job); } catch (e) { await finish(job, e); }
  }));
  return batch.length;
}

// ---------------- In-process scheduler ----------------
const g = globalThis as unknown as { __worker?: { timer: NodeJS.Timeout; busy: boolean; lastSweep: number } };

export function startWorker(intervalMs: number) {
  if (g.__worker) return;
  const state = { timer: undefined as unknown as NodeJS.Timeout, busy: false, lastSweep: 0 };
  state.timer = setInterval(async () => {
    if (state.busy) return; // never overlap ticks
    state.busy = true;
    try {
      await runJobsOnce();
      if (Date.now() - state.lastSweep > 60_000) {
        state.lastSweep = Date.now();
        await runRenewals();
        await expireStaleOrders();
      }
    } catch (e) {
      console.error("[worker] tick failed", e instanceof Error ? e.message : e);
    } finally {
      state.busy = false;
    }
  }, intervalMs);
  state.timer.unref();
  g.__worker = state;
  console.log(`[worker] started (interval ${intervalMs}ms)`);
}
