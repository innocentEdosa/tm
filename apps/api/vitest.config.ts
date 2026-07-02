import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one physical Postgres instance and commit real rows (no
    // per-test transactional rollback across files — see tests/helpers/pg.ts). One test
    // (provision-tenant-missing-role-template) also transiently mutates the global
    // `role_templates` seed row; running files in parallel risks another file reading it
    // mid-mutation. Sequential execution trades some wall-clock time for determinism.
    fileParallelism: false,
  },
});
