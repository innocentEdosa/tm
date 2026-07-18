import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { formFields } from "../../src/db/schema/custom-fields";

describe("POST /tenants/:id/custom-fields (spec FR-008/FR-009)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a field with tenant_id set to the target tenant and created_by super_admin", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/custom-fields`,
        headers: { cookie: cookieHeader },
        payload: { formKey: "member", label: `Console Field ${randomUUID()}`, fieldType: "text" },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(formFields).where(eq(formFields.id, body.data.id)),
      );
      expect(row.tenantId).toBe(tenantId);
      expect(row.createdBy).toBe("super_admin");
    } finally {
      await server.close();
    }
  });

  it("404s for an unknown form type", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/custom-fields`,
        headers: { cookie: cookieHeader },
        payload: { formKey: "not_a_real_form", label: "X", fieldType: "text" },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
