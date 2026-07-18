import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedGlobalField } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe(
  "Mandatory regression: a global field is unreachable through PATCH /tenants/:id/custom-fields/:fieldId " +
    "(spec FR-009, research.md §2 — proves this route's own tenant_id filter blocks it, not RLS, " +
    "which alone (migration 0028) would permit reaching it)",
  () => {
    afterAll(async () => {
      await closeTestPool();
    });

    it("returns 404 for a global (tenant_id IS NULL) field id, for any tenant", async () => {
      const tenantId = randomUUID();
      await seedTenant(tenantId);
      const globalField = await seedGlobalField("member");
      try {
        const { cookieHeader } = await seedSuperAdminSession();
        const server = await buildTestServer();
        try {
          const response = await server.inject({
            method: "PATCH",
            url: `/tenants/${tenantId}/custom-fields/${globalField.id}`,
            headers: { cookie: cookieHeader },
            payload: { label: "Attempted Edit Of Global Field" },
          });
          expect(response.statusCode).toBe(404);
        } finally {
          await server.close();
        }
      } finally {
        await globalField.cleanup();
      }
    });
  },
);
