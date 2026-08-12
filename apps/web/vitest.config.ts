import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Scoped to pure, framework-free `.ts` logic only (no jsdom, no component rendering) — mirrors
 * `packages/form-builder/vitest.config.ts`'s own precedent for this monorepo. Introduced in the
 * AI Course Experience — UI Consistency phase specifically to unit-test the proposal-description and
 * status-display logic extracted out of their React components for exactly this reason.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
