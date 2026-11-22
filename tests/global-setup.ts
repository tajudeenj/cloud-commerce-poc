import { execSync } from "node:child_process";
import pg from "pg";

/** Resets the dedicated test database, then migrates and seeds it. Refuses to run against a non-test DB. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://cloudpoc:cloudpoc@localhost:5432/cloudpoc_test";
  if (!/_test(\?|$)/.test(url)) throw new Error("Refusing to reset a database whose name does not end in _test");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  const env = { ...process.env, DATABASE_URL: url, SESSION_SECRET: "x".repeat(40), PAYMENT_HMAC_SECRET: "y".repeat(40) };
  execSync("npx tsx scripts/migrate.ts", { env, stdio: "inherit" });
  execSync("npx tsx scripts/seed.ts", { env, stdio: "inherit" });
}
