import { sql } from "drizzle-orm";
import {
  bigint, bigserial, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

/** All money is stored as integer minor units (fils; 1 JOD = 1000 fils) to avoid floating-point drift. */

export const roleEnum = pgEnum("role", ["customer", "admin"]);
export const cycleEnum = pgEnum("billing_cycle", ["monthly", "quarterly", "annual"]);
export const orderKindEnum = pgEnum("order_kind", ["new", "upgrade", "renewal"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "paid", "failed", "cancelled"]);
export const subStatusEnum = pgEnum("subscription_status", [
  "provisioning", "active", "suspended", "cancel_pending", "cancelled", "failed",
]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "done", "failed"]);
export const jobKindEnum = pgEnum("job_kind", ["provision", "modify", "deprovision", "renewal_sweep"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "answered", "customer_reply", "closed"]);
export const ticketPriorityEnum = pgEnum("ticket_priority", ["low", "medium", "high", "critical"]);
export const couponKindEnum = pgEnum("coupon_kind", ["percent", "fixed"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("customer"),
  crmCustomerId: text("crm_customer_id"),
  paymentToken: text("payment_token"),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the opaque cookie token — the raw token is never stored. */
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  impersonatorId: uuid("impersonator_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId), index("sessions_exp_idx").on(t.expiresAt)]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  /** Customer-selectable options, e.g. { regions: [...], os: [...] } — editable from admin, no code changes. */
  options: jsonb("options").$type<Record<string, string[]>>().notNull().default({}),
  provisioningType: text("provisioning_type").notNull(),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
});

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
  /** Rank used to classify plan changes as upgrade (higher) or downgrade (lower). */
  tier: integer("tier").notNull().default(0),
  crmPriceCode: text("crm_price_code").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [index("plans_product_idx").on(t.productId)]);

export const addons = pgTable("addons", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  crmPriceCode: text("crm_price_code").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [index("addons_product_idx").on(t.productId)]);

/** Simulates the CRM price book in mock mode. In http mode prices come from the real CRM API. */
export const crmPriceBook = pgTable("crm_price_book", {
  code: text("code").primaryKey(),
  monthlyFils: bigint("monthly_fils", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("JOD"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [check("price_non_negative", sql`${t.monthlyFils} >= 0`)]);

export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  kind: couponKindEnum("kind").notNull(),
  /** percent: 1-100; fixed: fils */
  value: integer("value").notNull(),
  maxRedemptions: integer("max_redemptions"),
  redeemed: integer("redeemed").notNull().default(0),
  validUntil: ts("valid_until"),
  productId: uuid("product_id").references(() => products.id),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("coupons_code_uq").on(sql`upper(${t.code})`),
  check("coupon_value_positive", sql`${t.value} > 0`),
]);

export type LineItem = { code: string; description: string; amountFils: number };
export type SubConfig = { region?: string; os?: string; hostname?: string };

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: orderKindEnum("kind").notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  productId: uuid("product_id").notNull().references(() => products.id),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  subscriptionId: uuid("subscription_id"),
  cycle: cycleEnum("cycle").notNull(),
  addonCodes: jsonb("addon_codes").$type<string[]>().notNull().default([]),
  config: jsonb("config").$type<SubConfig>().notNull().default({}),
  lines: jsonb("lines").$type<LineItem[]>().notNull(),
  subtotalFils: bigint("subtotal_fils", { mode: "number" }).notNull(),
  discountFils: bigint("discount_fils", { mode: "number" }).notNull().default(0),
  totalFils: bigint("total_fils", { mode: "number" }).notNull(),
  couponId: uuid("coupon_id").references(() => coupons.id),
  /** Upgrade orders: the subscription's new full-cycle price applied once paid. */
  newCyclePriceFils: bigint("new_cycle_price_fils", { mode: "number" }),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  gatewayRef: text("gateway_ref"),
  createdAt: createdAt(),
  paidAt: ts("paid_at"),
}, (t) => [index("orders_user_idx").on(t.userId), index("orders_status_created_idx").on(t.status, t.createdAt)]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  /** Downgrades are scheduled for the next renewal to avoid refunds/credits mid-cycle. */
  pendingPlanId: uuid("pending_plan_id").references(() => plans.id),
  cycle: cycleEnum("cycle").notNull(),
  addonCodes: jsonb("addon_codes").$type<string[]>().notNull().default([]),
  config: jsonb("config").$type<SubConfig>().notNull().default({}),
  status: subStatusEnum("status").notNull().default("provisioning"),
  pricePerCycleFils: bigint("price_per_cycle_fils", { mode: "number" }).notNull(),
  currentPeriodStart: ts("current_period_start").notNull(),
  currentPeriodEnd: ts("current_period_end").notNull(),
  autoRenew: boolean("auto_renew").notNull().default(true),
  externalRef: text("external_ref"),
  serviceDetails: jsonb("service_details").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
  cancelledAt: ts("cancelled_at"),
}, (t) => [
  index("subs_user_idx").on(t.userId),
  index("subs_renewal_idx").on(t.status, t.currentPeriodEnd),
]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: bigserial("number", { mode: "number" }).notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  orderId: uuid("order_id").references(() => orders.id).unique(),
  lines: jsonb("lines").$type<LineItem[]>().notNull(),
  subtotalFils: bigint("subtotal_fils", { mode: "number" }).notNull(),
  discountFils: bigint("discount_fils", { mode: "number" }).notNull().default(0),
  totalFils: bigint("total_fils", { mode: "number" }).notNull(),
  status: text("status").notNull().default("paid"),
  issuedAt: ts("issued_at").notNull().defaultNow(),
}, (t) => [index("invoices_user_idx").on(t.userId)]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orderId: uuid("order_id").references(() => orders.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  gatewayRef: text("gateway_ref").notNull().unique(),
  amountFils: bigint("amount_fils", { mode: "number" }).notNull(),
  method: text("method").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
}, (t) => [index("payments_user_idx").on(t.userId)]);

/** Transactional outbox: written in the same DB transaction as the business change, executed by the worker. */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: jobKindEnum("kind").notNull(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: jobStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(6),
  nextRunAt: ts("next_run_at").notNull().defaultNow(),
  lockedUntil: ts("locked_until"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("jobs_due_idx").on(t.status, t.nextRunAt)]);

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: bigserial("number", { mode: "number" }).notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  subject: text("subject").notNull(),
  status: ticketStatusEnum("status").notNull().default("open"),
  priority: ticketPriorityEnum("priority").notNull().default("medium"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
}, (t) => [index("tickets_user_idx").on(t.userId), index("tickets_status_idx").on(t.status, t.updatedAt)]);

export const ticketMessages = pgTable("ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  isStaff: boolean("is_staff").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("ticket_msgs_ticket_idx").on(t.ticketId, t.createdAt)]);

/** Append-only audit trail. A DB trigger (see migration 0001) blocks UPDATE/DELETE. */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorId: uuid("actor_id"),
  impersonatorId: uuid("impersonator_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  createdAt: createdAt(),
}, (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entity, t.entityId)]);

/** Behavioural analytics (funnel / cart abandonment). */
export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id"),
  visitorId: text("visitor_id").notNull(),
  type: text("type").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("events_type_created_idx").on(t.type, t.createdAt), index("events_visitor_idx").on(t.visitorId)]);

/** Low-code site content (hero text, banners) editable from admin. */
export const siteContent = pgTable("site_content", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
