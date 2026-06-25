import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/tests/**/*.test.ts", "apps/**/tests/**/*.test.ts"],
    globals: false
  }
});
