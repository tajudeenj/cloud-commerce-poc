import { describe, expect, it } from "vitest";
import { addMonths, couponDiscount, cyclePrice, formatJod, periodEnd, prorate } from "@/lib/billing-math";

describe("cyclePrice", () => {
  it("applies commitment discounts per cycle", () => {
    expect(cyclePrice(10_000, "monthly")).toBe(10_000);
    expect(cyclePrice(10_000, "quarterly")).toBe(28_500); // 30,000 - 5%
    expect(cyclePrice(10_000, "annual")).toBe(102_000); // 120,000 - 15%
  });
  it("rejects invalid money", () => {
    expect(() => cyclePrice(-1, "monthly")).toThrow();
    expect(() => cyclePrice(1.5, "monthly")).toThrow();
  });
});

describe("couponDiscount", () => {
  it("handles percent and fixed coupons and never exceeds subtotal", () => {
    expect(couponDiscount(20_000, { kind: "percent", value: 10 })).toBe(2_000);
    expect(couponDiscount(3_000, { kind: "fixed", value: 5_000 })).toBe(3_000);
    expect(couponDiscount(20_000, { kind: "percent", value: 250 })).toBe(20_000);
    expect(couponDiscount(20_000, null)).toBe(0);
  });
});

describe("dates", () => {
  it("clamps to month end", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(periodEnd(new Date("2026-11-22T00:00:00Z"), "annual").toISOString()).toBe("2027-11-22T00:00:00.000Z");
  });
});

describe("prorate", () => {
  const start = new Date("2026-11-01T00:00:00Z");
  const end = new Date("2026-12-01T00:00:00Z");
  it("charges the remaining fraction of the price difference", () => {
    const mid = new Date("2026-11-16T00:00:00Z");
    expect(prorate({ oldCycleFils: 10_000, newCycleFils: 20_000, periodStart: start, periodEnd: end, now: mid })).toBe(5_000);
  });
  it("is negative for downgrades and zero after the period ends", () => {
    const mid = new Date("2026-11-16T00:00:00Z");
    expect(prorate({ oldCycleFils: 20_000, newCycleFils: 10_000, periodStart: start, periodEnd: end, now: mid })).toBeLessThan(0);
    expect(prorate({ oldCycleFils: 10_000, newCycleFils: 20_000, periodStart: start, periodEnd: end, now: new Date("2027-01-01Z") })).toBe(0);
  });
});

it("formats JOD with three decimals", () => {
  expect(formatJod(6_500)).toBe("JOD 6.500");
  expect(formatJod(1_234_567)).toBe("JOD 1,234.567");
});
