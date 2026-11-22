/** Resilient JSON-over-HTTP client for backend integrations: timeouts, bounded retries with jittered back-off. */
export class IntegrationError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = true) {
    super(message);
    this.name = "IntegrationError";
  }
}

type Opts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  idempotencyKey?: string;
};

export async function httpJson<T>(url: string, opts: Opts = {}): Promise<T> {
  const { method = "GET", body, headers = {}, timeoutMs = 8_000, retries = 2, idempotencyKey } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        throw new IntegrationError(`${method} ${new URL(url).pathname} → HTTP ${res.status}`, res.status, retryable);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const retryable = !(err instanceof IntegrationError) || err.retryable;
      if (!retryable || attempt === retries) break;
      const delay = Math.min(250 * 2 ** attempt, 2_000) + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new IntegrationError(String(lastErr));
}
