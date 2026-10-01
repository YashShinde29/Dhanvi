import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" } },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          // One PostgreSQL + Redis container pair for the whole run; files run serially against isolated databases.
          globalSetup: ["test/support/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
