/** Pure billing arithmetic — no I/O, fully unit-tested. Money is integer fils (1 JOD = 1000 fils). */

export const CYCLES = ["monthly", "quarterly", "annual"] as const;
export type Cycle = (typeof CYCLES)[number];

export const CYCLE_MONTHS: Record<Cycle, number> = { monthly: 1, quarterly: 3, annual: 12 };
/** Commitment discount in basis points (500 = 5%). */
export const CYCLE_DISCOUNT_BPS: Record<Cycle, number> = { monthly: 0, quarterly: 500, annual: 1500 };
export const CYCLE_LABEL: Record<Cycle, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

/** Price for one billing cycle given a monthly list price; rounds half-up to the nearest fils. */
export function cyclePrice(monthlyFils: number, cycle: Cycle): number {
  assertMoney(monthlyFils);
  const gross = monthlyFils * CYCLE_MONTHS[cycle];
  return gross - Math.round((gross * CYCLE_DISCOUNT_BPS[cycle]) / 10_000);
}

export type Coupon = { kind: "percent" | "fixed"; value: number };

export function couponDiscount(subtotalFils: number, coupon: Coupon | null): number {
  assertMoney(subtotalFils);
  if (!coupon) return 0;
  const raw = coupon.kind === "percent"
    ? Math.round((subtotalFils * Math.min(Math.max(coupon.value, 0), 100)) / 100)
    : coupon.value;
  return Math.min(Math.max(raw, 0), subtotalFils);
}

/** Adds calendar months, clamping to month end (Jan 31 + 1 month = Feb 28/29). UTC-based. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function periodEnd(start: Date, cycle: Cycle): Date {
  return addMonths(start, CYCLE_MONTHS[cycle]);
}

/**
 * Prorated charge for moving from the current cycle price to a new one mid-period.
 * Positive → immediate upgrade charge. Zero/negative → treat as downgrade at next renewal.
 */
export function prorate(params: {
  oldCycleFils: number; newCycleFils: number; periodStart: Date; periodEnd: Date; now: Date;
}): number {
  const { oldCycleFils, newCycleFils, periodStart, periodEnd: end, now } = params;
  const total = end.getTime() - periodStart.getTime();
  if (total <= 0) return 0;
  const remaining = Math.min(Math.max(end.getTime() - now.getTime(), 0), total);
  return Math.round(((newCycleFils - oldCycleFils) * remaining) / total);
}

export function formatJod(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 1000).toLocaleString("en-US");
  const frac = String(abs % 1000).padStart(3, "0");
  return `${sign}JOD ${whole}.${frac}`;
}

function assertMoney(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Invalid money amount: ${n}`);
}
