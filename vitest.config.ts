import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // bench/ is a separate sub-package with its own vitest config; never run or
    // cover it from the main package's test suite.
    exclude: [...configDefaults.exclude, "bench/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
