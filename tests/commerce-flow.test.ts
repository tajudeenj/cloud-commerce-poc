import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema, closeDb } from "@/lib/db";
import { signParams, payments } from "@/lib/adapters/payment";
import { DomainError, quote } from "@/lib/services/catalog";
import { changePlan, completePayment, setCancellation, startCheckout, type Actor } from "@/lib/services/orders";
import { runJobsOnce, runRenewals } from "@/lib/services/worker";
import { closeTicket, createTicket, getTicket, replyTicket } from "@/lib/services/tickets";
import { dashboard } from "@/lib/services/analytics";

let actor: Actor;
const key = () => `k_${crypto.randomUUID().replace(/-/g, "")}`;

function gatewayCallback(orderId: string, amount: number, status = "success", token = "tok_test_ok") {
  const p = { orderId, status, amount: String(amount), txnRef: `TXN-${crypto.randomUUID()}`, token, method: "visa", ts: String(Date.now()) };
  return { ...p, sig: signParams(p) };
}

async function drainJobs() {
  for (let i = 0; i < 5; i++) if ((await runJobsOnce()) === 0) break;
}

beforeAll(async () => {
  const u = await db().query.users.findFirst({ where: eq(schema.users.email, "customer@demo.jo") });
  actor = { userId: u!.id, ip: "127.0.0.1" };
});
afterAll(async () => { await closeDb(); });

describe("pricing", () => {
  it("prices server-side from the CRM price book with cycle discount and coupon", async () => {
    const q = await quote({ productSlug: "vps", planCode: "VPS-M", cycle: "annual", addonCodes: ["VPS-BACKUP"], couponCode: "welcome10", config: { region: "Amman-1", os: "Debian 13" } });
    expect(q.subtotalFils).toBe(131_580 + 15_300); // (12,900 + 1,500) * 12 * 0.85
    expect(q.discountFils).toBe(Math.round(q.subtotalFils * 0.1));
    expect(q.couponMessage).toMatch(/applied/);
  });
  it("rejects tampered selections", async () => {
    await expect(quote({ productSlug: "vps", planCode: "MAIL-5", cycle: "monthly", addonCodes: [], config: { region: "Amman-1", os: "Debian 13" } })).rejects.toBeInstanceOf(DomainError);
    await expect(quote({ productSlug: "vps", planCode: "VPS-S", cycle: "monthly", addonCodes: ["DNS-SEC"], config: { region: "Amman-1", os: "Debian 13" } })).rejects.toBeInstanceOf(DomainError);
    await expect(quote({ productSlug: "vps", planCode: "VPS-S", cycle: "monthly", addonCodes: [], config: { region: "Mars-1", os: "Debian 13" } })).rejects.toBeInstanceOf(DomainError);
    await expect(quote({ productSlug: "vps", planCode: "VPS-S", cycle: "monthly", addonCodes: [], config: { region: "Amman-1", os: "Debian 13", hostname: "bad host'; drop" } })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("order → payment → provisioning", () => {
  let subscriptionId: string;

  it("is idempotent on double submit", async () => {
    const k = key();
    const input = { productSlug: "vps", planCode: "VPS-S", cycle: "monthly" as const, addonCodes: [], config: { region: "Amman-1", os: "Ubuntu 24.04 LTS", hostname: "web01.example.jo" } };
    const [a, b] = await Promise.all([startCheckout(actor, input, k), startCheckout(actor, input, k)]);
    expect(a.orderId).toBe(b.orderId);
    expect(a.redirectUrl).toContain("/mock-gateway?");
  });

  it("rejects forged and amount-tampered callbacks, then fulfils exactly once", async () => {
    const { orderId } = await startCheckout(actor, { productSlug: "vps", planCode: "VPS-S", cycle: "monthly", addonCodes: ["VPS-BACKUP"], couponCode: "CLOUD5", config: { region: "Amman-1", os: "Ubuntu 24.04 LTS" } }, key());
    const order = (await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
    expect(order.totalFils).toBe(6_500 + 1_500 - 5_000);

    const forged = { ...gatewayCallback(orderId, order.totalFils), sig: "0".repeat(64) };
    expect(payments().verifyCallback(forged)).toBeNull();

    const cb = payments().verifyCallback(gatewayCallback(orderId, order.totalFils))!;
    const [r1, r2] = await Promise.all([completePayment(cb), completePayment(cb)]);
    expect(r1.status).toBe("paid");
    expect(r2.status).toBe("paid");
    subscriptionId = r1.subscriptionId!;
    const invoices = await db().select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId));
    expect(invoices).toHaveLength(1);

    await drainJobs();
    const sub = (await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) }))!;
    expect(sub.status).toBe("active");
    expect(sub.externalRef).toMatch(/^VPS-/);
    expect(sub.serviceDetails["IPv4 address"]).toBeTruthy();
  });

  it("marks the order failed when the amount does not match", async () => {
    const { orderId } = await startCheckout(actor, { productSlug: "dns", planCode: "DNS-STD", cycle: "monthly", addonCodes: [] }, key());
    const cb = payments().verifyCallback(gatewayCallback(orderId, 1))!;
    expect((await completePayment(cb)).status).toBe("failed");
  });

  it("charges prorated upgrades and schedules downgrades for renewal", async () => {
    const up = await changePlan(actor, subscriptionId, "VPS-L", ["VPS-BACKUP"], key());
    expect(up.redirectUrl).toContain("/mock-gateway?");
    const orderId = new URL(up.redirectUrl, "http://x").searchParams.get("orderId")!;
    const o = (await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
    expect(o.kind).toBe("upgrade");
    expect(o.totalFils).toBeGreaterThan(0);
    await completePayment(payments().verifyCallback(gatewayCallback(orderId, o.totalFils))!);
    await drainJobs();
    let sub = (await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) }))!;
    expect(sub.pricePerCycleFils).toBe(24_900 + 1_500);

    const down = await changePlan(actor, subscriptionId, "VPS-S", ["VPS-BACKUP"], key());
    expect(down.redirectUrl).toContain("change-scheduled");
    sub = (await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) }))!;
    expect(sub.pendingPlanId).not.toBeNull();
  });

  it("renews on the saved token, applying the scheduled downgrade", async () => {
    await db().update(schema.subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 1000) }).where(eq(schema.subscriptions.id, subscriptionId));
    const r = await runRenewals();
    expect(r.renewed).toBeGreaterThanOrEqual(1);
    const sub = (await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) }))!;
    expect(sub.pendingPlanId).toBeNull();
    expect(sub.pricePerCycleFils).toBe(6_500 + 1_500);
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    // Running again must not double-renew.
    expect((await runRenewals()).renewed).toBe(0);
  });

  it("cancels at period end and deprovisions", async () => {
    await setCancellation(actor, subscriptionId, true);
    await db().update(schema.subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 1000) }).where(eq(schema.subscriptions.id, subscriptionId));
    expect((await runRenewals()).cancelled).toBe(1);
    await drainJobs();
    const sub = (await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) }))!;
    expect(sub.status).toBe("cancelled");
  });

  it("compensates a permanent provisioning failure", async () => {
    const { orderId } = await startCheckout(actor, { productSlug: "vps", planCode: "VPS-S", cycle: "monthly", addonCodes: [], config: { region: "Amman-1", os: "Debian 13", hostname: "fail.example.jo" } }, key());
    const o = (await db().query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
    const r = await completePayment(payments().verifyCallback(gatewayCallback(orderId, o.totalFils))!);
    await drainJobs();
    const sub = (await db().query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, r.subscriptionId!) }))!;
    expect(sub.status).toBe("failed");
  });
});

describe("tickets and audit", () => {
  it("supports customer ↔ staff conversation with ownership checks", async () => {
    const admin = (await db().query.users.findFirst({ where: eq(schema.users.role, "admin") }))!;
    const other = (await db().insert(schema.users).values({ email: `x${Date.now()}@t.jo`, name: "Other", passwordHash: "x" }).returning())[0]!;
    const t = await createTicket(actor, { subject: "VPS slow", body: "Disk latency high", priority: "high" });
    expect(await getTicket(t.id, { userId: other.id, isStaff: false })).toBeNull();
    await replyTicket({ userId: admin.id, isStaff: true }, t.id, "Investigating now");
    await expect(replyTicket({ userId: other.id, isStaff: false }, t.id, "hijack")).rejects.toBeInstanceOf(DomainError);
    await closeTicket({ userId: admin.id, isStaff: true }, t.id);
    const full = (await getTicket(t.id, { userId: actor.userId, isStaff: false }))!;
    expect(full.status).toBe("closed");
    expect(full.messages).toHaveLength(2);
  });

  it("keeps the audit trail append-only", async () => {
    await expect(db().execute(sql`delete from audit_log`)).rejects.toThrow();
    const [{ n }] = (await db().execute<{ n: number }>(sql`select count(*)::int as n from audit_log`)).rows as [{ n: number }];
    expect(n).toBeGreaterThan(0);
  });

  it("produces dashboard analytics", async () => {
    const d = await dashboard(30);
    expect(d.revenueFils).toBeGreaterThan(0);
    expect(d.funnel.find((f) => f.step === "purchased")!.visitors).toBeGreaterThan(0);
  });
});
