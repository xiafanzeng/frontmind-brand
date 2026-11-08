import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Standalone assembly stays in the child repository. Dashboard exercises its own
// authenticated adapters; these three tests require the excluded child shell.
const standalone = existsSync(new URL("../standalone", import.meta.url));
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["client/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    exclude: standalone ? [] : [
      "client/App.response-logic.integration.test.tsx",
      "tests/intent-preview.test.ts",
      "tests/standalone-routes.test.ts",
    ],
    pool: "forks",
    // The immutable image builder is intentionally resource-bounded. Keeping
    // one worker avoids fork RPC starvation while retaining process isolation.
    maxWorkers: 1,
    minWorkers: 1,
  },
});
