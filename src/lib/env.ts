import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  BRAND_NAME: z.string().min(1).default("Umniah Cloud"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  CRM_MODE: z.enum(["mock", "http"]).default("mock"),
  CRM_BASE_URL: z.string().optional(),
  CRM_API_KEY: z.string().optional(),
  PRICE_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  PAYMENT_MODE: z.enum(["mock", "http"]).default("mock"),
  PAYMENT_GATEWAY_URL: z.string().optional(),
  PAYMENT_HMAC_SECRET: z.string().min(32, "PAYMENT_HMAC_SECRET must be at least 32 characters"),
  PROVISIONING_MODE: z.enum(["mock", "http"]).default("mock"),
  PROVISIONING_BASE_URL: z.string().optional(),
  PROVISIONING_API_KEY: z.string().optional(),
  WORKER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(500).max(60000).default(3000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
/** Validated lazily so `next build` does not require runtime secrets. Fails fast on first use. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
