import "server-only";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { TtlCache } from "@/lib/ttl-cache";
import { httpJson, IntegrationError } from "./http";

/** Contract with Umniah CRM. Swap implementation via CRM_MODE without touching business logic. */
export interface CrmAdapter {
  /** Monthly list price (fils) per price code. Throws if any requested code is unknown. */
  getMonthlyPrices(codes: string[]): Promise<Map<string, number>>;
  upsertCustomer(c: { id: string; email: string; name: string }): Promise<string>;
}

class MockCrm implements CrmAdapter {
  async getMonthlyPrices(codes: string[]) {
    if (codes.length === 0) return new Map<string, number>();
    const rows = await db().select().from(schema.crmPriceBook).where(inArray(schema.crmPriceBook.code, codes));
    return new Map(rows.map((r) => [r.code, r.monthlyFils]));
  }
  async upsertCustomer(c: { id: string }) {
    return `CRM-${c.id.slice(0, 8).toUpperCase()}`;
  }
}

class HttpCrm implements CrmAdapter {
  private base() {
    const e = env();
    if (!e.CRM_BASE_URL) throw new IntegrationError("CRM_BASE_URL not configured", undefined, false);
    return { url: e.CRM_BASE_URL.replace(/\/$/, ""), headers: { Authorization: `Bearer ${e.CRM_API_KEY ?? ""}` } };
  }
  async getMonthlyPrices(codes: string[]) {
    const { url, headers } = this.base();
    const qs = new URLSearchParams({ codes: codes.join(",") });
    const data = await httpJson<{ prices: { code: string; monthlyFils: number }[] }>(`${url}/prices?${qs}`, { headers });
    return new Map(data.prices.map((p) => [p.code, p.monthlyFils]));
  }
  async upsertCustomer(c: { id: string; email: string; name: string }) {
    const { url, headers } = this.base();
    const data = await httpJson<{ customerId: string }>(`${url}/customers`, {
      method: "POST", headers, body: { externalId: c.id, email: c.email, name: c.name }, idempotencyKey: `cust-${c.id}`,
    });
    return data.customerId;
  }
}

const g = globalThis as unknown as { __crm?: CrmAdapter; __priceCache?: TtlCache<number> };

export function crm(): CrmAdapter {
  return (g.__crm ??= env().CRM_MODE === "http" ? new HttpCrm() : new MockCrm());
}

function priceCache() {
  return (g.__priceCache ??= new TtlCache<number>(env().PRICE_CACHE_TTL_SECONDS * 1000));
}

/** Dynamic CRM pricing with a short TTL cache; unknown codes fail closed (never sell at an unknown price). */
export async function getPrices(codes: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(codes)];
  const cache = priceCache();
  const result = new Map<string, number>();
  const missing: string[] = [];
  for (const c of unique) {
    const v = cache.get(c);
    if (v === undefined) missing.push(c); else result.set(c, v);
  }
  if (missing.length) {
    const fetched = await crm().getMonthlyPrices(missing);
    for (const c of missing) {
      const v = fetched.get(c);
      if (v === undefined || !Number.isSafeInteger(v) || v < 0) {
        throw new IntegrationError(`Price not available from CRM for code ${c}`, undefined, false);
      }
      cache.set(c, v);
      result.set(c, v);
    }
  }
  return result;
}

export function invalidatePrices(code?: string) {
  priceCache().invalidate(code);
}
