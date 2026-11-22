import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://cloudpoc:cloudpoc@localhost:5432/cloudpoc_test",
      SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789",
      PAYMENT_HMAC_SECRET: "test-hmac-secret-0123456789abcdef0123456789abc",
      PRICE_CACHE_TTL_SECONDS: "0",
      WORKER_ENABLED: "false",
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
