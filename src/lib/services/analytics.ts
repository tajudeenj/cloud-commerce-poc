import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const ALLOWED = new Set(["product_view", "configure", "checkout_started", "purchased"]);

/** Fire-and-forget behavioural event; never breaks the user flow. */
export async function track(e: { userId?: string | null; visitorId: string; type: string; data?: Record<string, unknown> }) {
  if (!ALLOWED.has(e.type) || !e.visitorId) return;
  await db().insert(schema.events).values({
    userId: e.userId ?? null, visitorId: e.visitorId.slice(0, 64), type: e.type, data: e.data ?? {},
  }).catch((err) => console.warn("[analytics] drop event", err.message));
}

export async function dashboard(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const d = db();
  const one = async <T>(q: Promise<T[]>) => (await q)[0]!;

  const [revenue, active, mrr, openTickets, funnelRows, byProduct, abandoned, daily, coupons] = await Promise.all([
    one(d.select({ total: sql<number>`coalesce(sum(${schema.payments.amountFils}),0)::bigint`, count: sql<number>`count(*)::int` })
      .from(schema.payments).where(gte(schema.payments.createdAt, since))),
    one(d.select({ n: sql<number>`count(*)::int` }).from(schema.subscriptions)
      .where(sql`${schema.subscriptions.status} in ('active','cancel_pending','provisioning')`)),
    // Normalised monthly recurring revenue across billing cycles.
    one(d.select({ mrr: sql<number>`coalesce(sum(${schema.subscriptions.pricePerCycleFils} / case ${schema.subscriptions.cycle} when 'monthly' then 1 when 'quarterly' then 3 else 12 end),0)::bigint` })
      .from(schema.subscriptions).where(sql`${schema.subscriptions.status} in ('active','cancel_pending')`)),
    one(d.select({ n: sql<number>`count(*)::int` }).from(schema.tickets).where(sql`${schema.tickets.status} <> 'closed'`)),
    d.select({ type: schema.events.type, visitors: sql<number>`count(distinct coalesce(${schema.events.userId}::text, ${schema.events.visitorId}))::int` })
      .from(schema.events).where(gte(schema.events.createdAt, since)).groupBy(schema.events.type),
    d.select({ product: schema.products.name, subs: sql<number>`count(${schema.subscriptions.id})::int`,
      mrr: sql<number>`coalesce(sum(${schema.subscriptions.pricePerCycleFils} / case ${schema.subscriptions.cycle} when 'monthly' then 1 when 'quarterly' then 3 else 12 end),0)::bigint` })
      .from(schema.products)
      .leftJoin(schema.subscriptions, and(eq(schema.subscriptions.productId, schema.products.id), sql`${schema.subscriptions.status} in ('active','cancel_pending','provisioning')`))
      .groupBy(schema.products.name).orderBy(schema.products.name),
    // Cart abandonment: checkout started but order never paid.
    d.select({ id: schema.orders.id, email: schema.users.email, total: schema.orders.totalFils, createdAt: schema.orders.createdAt, status: schema.orders.status })
      .from(schema.orders).innerJoin(schema.users, eq(schema.users.id, schema.orders.userId))
      .where(and(gte(schema.orders.createdAt, since), sql`${schema.orders.status} in ('pending','cancelled','failed')`, eq(schema.orders.kind, "new")))
      .orderBy(desc(schema.orders.createdAt)).limit(10),
    d.select({ day: sql<string>`to_char(date_trunc('day', ${schema.payments.createdAt}), 'YYYY-MM-DD')`, total: sql<number>`sum(${schema.payments.amountFils})::bigint` })
      .from(schema.payments).where(gte(schema.payments.createdAt, since))
      .groupBy(sql`1`).orderBy(sql`1`),
    d.select({ code: schema.coupons.code, redeemed: schema.coupons.redeemed }).from(schema.coupons).orderBy(desc(schema.coupons.redeemed)).limit(5),
  ]);

  const f = Object.fromEntries(funnelRows.map((r) => [r.type, r.visitors]));
  const funnel = ["product_view", "configure", "checkout_started", "purchased"].map((k) => ({ step: k, visitors: f[k] ?? 0 }));
  return {
    revenueFils: Number(revenue.total), paymentsCount: revenue.count, activeSubs: active.n, mrrFils: Number(mrr.mrr),
    openTickets: openTickets.n, funnel, byProduct: byProduct.map((r) => ({ ...r, mrr: Number(r.mrr) })),
    abandoned, daily: lastNDays(14, new Map(daily.map((r) => [r.day, Number(r.total)]))), coupons,
  };
}

/** Fixed-length daily series (zero-filled) so charts have a stable time axis. */
function lastNDays(n: number, totals: Map<string, number>) {
  const out: { day: string; total: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, total: totals.get(day) ?? 0 });
  }
  return out;
}
