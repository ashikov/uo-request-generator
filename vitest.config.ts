import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"],
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/*/src/**/*.ts",
        "apps/web/src/**/*.ts",
        "apps/web/public/**/*.js",
        "scripts/**/*.mjs",
      ],
      reporter: ["text-summary", "html", "lcovonly"],
    },
  },
});
