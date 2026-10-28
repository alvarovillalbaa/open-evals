import { defineConfig } from "vitest/config";

// Explicit client scope; the repository-wide config includes only .test.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/sdk/tests/prompts.test.mjs",
      "apps/cli/tests/prompt-files.test.ts",
      "apps/cli/tests/prompt-cli.test.ts",
      "apps/cli/tests/prompt-bin.test.mjs"
    ],
    globals: false,
    maxWorkers: 1,
    fileParallelism: false,
    retry: 0,
    testTimeout: 60_000,
    hookTimeout: 20_000
  }
});
