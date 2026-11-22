import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

// Single pool per process (survives Next.js dev hot reloads via globalThis).
const g = globalThis as unknown as { __pgPool?: Pool; __db?: DB };

export function db(): DB {
  if (g.__db) return g.__db;
  const e = env();
  const pool = new Pool({
    connectionString: e.DATABASE_URL,
    max: e.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    application_name: "cloud-commerce",
  });
  pool.on("error", (err) => console.error("[db] idle client error", err.message));
  g.__pgPool = pool;
  g.__db = drizzle(pool, { schema });
  return g.__db;
}

export async function closeDb() {
  await g.__pgPool?.end();
  g.__pgPool = undefined;
  g.__db = undefined;
}

export { schema };
