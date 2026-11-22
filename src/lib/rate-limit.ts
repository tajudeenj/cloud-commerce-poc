/**
 * Fixed-window in-memory rate limiter with bounded memory.
 * Single-instance only — in production replace with Valkey (INCR + EXPIRE) so limits hold across replicas.
 */
type Bucket = { count: number; resetAt: number };
const MAX_KEYS = 50_000;
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const buckets = (g.__rl ??= new Map());

function bucket(key: string, windowMs: number, now: number): Bucket {
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  return b;
}

/** Counts this call and reports whether the caller is within the limit. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const b = bucket(key, windowMs, now);
  b.count += 1;
  return b.count > limit ? { ok: false, retryAfterMs: b.resetAt - now } : { ok: true, retryAfterMs: 0 };
}

/** Checks without counting — pair with `rateLimitHit` to count only failures (e.g. failed logins). */
export function rateLimitBlocked(key: string, limit: number, windowMs: number): boolean {
  return bucket(key, windowMs, Date.now()).count >= limit;
}
export function rateLimitHit(key: string, windowMs: number) {
  bucket(key, windowMs, Date.now()).count += 1;
}

function sweep(now: number) {
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  if (buckets.size >= MAX_KEYS) {
    let n = Math.ceil(MAX_KEYS / 10);
    for (const k of buckets.keys()) { buckets.delete(k); if (--n <= 0) break; }
  }
}
