import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { getPrices } from "@/lib/adapters/crm";
import { CYCLE_LABEL, couponDiscount, cyclePrice, type Cycle } from "@/lib/billing-math";
import type { LineItem, SubConfig } from "@/lib/db/schema";

export class DomainError extends Error {
  constructor(message: string, readonly code = "invalid_request") {
    super(message);
    this.name = "DomainError";
  }
}

export async function listProducts() {
  return db().query.products.findMany({
    where: eq(schema.products.active, true),
    orderBy: [asc(schema.products.sort), asc(schema.products.name)],
  });
}

export async function getProduct(slug: string) {
  const p = await db().query.products.findFirst({ where: and(eq(schema.products.slug, slug), eq(schema.products.active, true)) });
  if (!p) return null;
  const [plans, addons] = await Promise.all([
    db().select().from(schema.plans).where(and(eq(schema.plans.productId, p.id), eq(schema.plans.active, true))).orderBy(asc(schema.plans.tier)),
    db().select().from(schema.addons).where(and(eq(schema.addons.productId, p.id), eq(schema.addons.active, true))).orderBy(asc(schema.addons.name)),
  ]);
  return { ...p, plans, addons };
}

/** Starting monthly price per product (for listing cards), resolved from CRM. */
export async function startingPrices(productIds: string[]) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await db().select({ productId: schema.plans.productId, code: schema.plans.crmPriceCode })
    .from(schema.plans).where(eq(schema.plans.active, true));
  const prices = await getPrices(rows.map((r) => r.code));
  const out = new Map<string, number>();
  for (const r of rows) {
    const p = prices.get(r.code)!;
    if (!out.has(r.productId) || p < out.get(r.productId)!) out.set(r.productId, p);
  }
  return out;
}

export type QuoteInput = {
  productSlug: string;
  planCode: string;
  cycle: Cycle;
  addonCodes: string[];
  couponCode?: string | null;
  config?: SubConfig;
};

export type Quote = {
  productId: string;
  productName: string;
  provisioningType: string;
  planId: string;
  planName: string;
  cycle: Cycle;
  addonCodes: string[];
  config: SubConfig;
  lines: LineItem[];
  subtotalFils: number;
  discountFils: number;
  totalFils: number;
  couponId: string | null;
  couponMessage: string | null;
};

/** Server-authoritative pricing: the client never supplies amounts. */
export async function quote(input: QuoteInput, tx?: Tx): Promise<Quote> {
  const d = tx ?? db();
  const product = await d.query.products.findFirst({
    where: and(eq(schema.products.slug, input.productSlug), eq(schema.products.active, true)),
  });
  if (!product) throw new DomainError("Product not found");
  const plan = await d.query.plans.findFirst({
    where: and(eq(schema.plans.code, input.planCode), eq(schema.plans.productId, product.id), eq(schema.plans.active, true)),
  });
  if (!plan) throw new DomainError("Plan not available for this product");

  const addonCodes = [...new Set(input.addonCodes)].sort();
  const addons = addonCodes.length
    ? await d.select().from(schema.addons).where(and(eq(schema.addons.productId, product.id), eq(schema.addons.active, true)))
    : [];
  const selected = addons.filter((a) => addonCodes.includes(a.code));
  if (selected.length !== addonCodes.length) throw new DomainError("One or more add-ons are not available");

  const config = validateConfig(product.options, input.config ?? {});
  const prices = await getPrices([plan.crmPriceCode, ...selected.map((a) => a.crmPriceCode)]);
  const label = CYCLE_LABEL[input.cycle];
  const lines: LineItem[] = [
    { code: plan.code, description: `${product.name} — ${plan.name} (${label})`, amountFils: cyclePrice(prices.get(plan.crmPriceCode)!, input.cycle) },
    ...selected.map((a) => ({ code: a.code, description: `${a.name} (${label})`, amountFils: cyclePrice(prices.get(a.crmPriceCode)!, input.cycle) })),
  ];
  const subtotal = lines.reduce((s, l) => s + l.amountFils, 0);

  let couponId: string | null = null;
  let couponMessage: string | null = null;
  let discount = 0;
  const code = input.couponCode?.trim();
  if (code) {
    const c = await d.query.coupons.findFirst({ where: sql`upper(${schema.coupons.code}) = upper(${code})` });
    const reason = !c || !c.active ? "Coupon code is not valid"
      : c.validUntil && c.validUntil < new Date() ? "Coupon has expired"
      : c.maxRedemptions !== null && c.redeemed >= c.maxRedemptions ? "Coupon redemption limit reached"
      : c.productId && c.productId !== product.id ? "Coupon does not apply to this product"
      : null;
    if (reason || !c) couponMessage = reason;
    else {
      couponId = c.id;
      discount = couponDiscount(subtotal, { kind: c.kind, value: c.value });
      couponMessage = `Coupon ${c.code.toUpperCase()} applied`;
    }
  }

  return {
    productId: product.id, productName: product.name, provisioningType: product.provisioningType,
    planId: plan.id, planName: plan.name, cycle: input.cycle, addonCodes, config, lines,
    subtotalFils: subtotal, discountFils: discount, totalFils: subtotal - discount, couponId, couponMessage,
  };
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function validateConfig(options: Record<string, string[]>, cfg: SubConfig): SubConfig {
  const out: SubConfig = {};
  if (options.regions?.length) {
    if (!cfg.region || !options.regions.includes(cfg.region)) throw new DomainError("Please choose a valid region");
    out.region = cfg.region;
  }
  if (options.os?.length) {
    if (!cfg.os || !options.os.includes(cfg.os)) throw new DomainError("Please choose a valid operating system");
    out.os = cfg.os;
  }
  if (cfg.hostname) {
    const h = cfg.hostname.trim().toLowerCase();
    if (!HOSTNAME.test(h)) throw new DomainError("Hostname/domain is not valid");
    out.hostname = h;
  }
  return out;
}
