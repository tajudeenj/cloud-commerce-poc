/** Bounded TTL cache with in-flight request de-duplication (single-flight). */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();
  private inflight = new Map<string, Promise<V>>();

  constructor(private ttlMs: number, private maxEntries = 10_000) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) { this.store.delete(key); return undefined; }
    return hit.value;
  }

  set(key: string, value: V) {
    if (this.ttlMs <= 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  async getOrLoad(key: string, loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = loader()
      .then((v) => { this.set(key, v); return v; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  invalidate(key?: string) {
    if (key === undefined) this.store.clear();
    else this.store.delete(key);
  }
}
