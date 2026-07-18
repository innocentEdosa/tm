import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedGlobalField } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("Field-key collision on POST /tenants/:id/custom-fields (spec FR-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("409s against this tenant's own existing field key", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const fieldKey = `dup_${randomUUID().replace(/-/g, "")}`;
      const first = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/custom-fields`,
        headers: { cookie: cookieHeader },
        payload: { formKey: "member", label: "First", fieldKey, fieldType: "text" },
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/custom-fields`,
        headers: { cookie: cookieHeader },
        payload: { formKey: "member", label: "Second", fieldKey, fieldType: "text" },
      });
      expect(second.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("409s against an existing global field key", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const fieldKey = `global_dup_${randomUUID().replace(/-/g, "")}`;
    const globalField = await seedGlobalField("member", { fieldKey });
    try {
      const { cookieHeader } = await seedSuperAdminSession();
      const server = await buildTestServer();
      try {
        const response = await server.inject({
          method: "POST",
          url: `/tenants/${tenantId}/custom-fields`,
          headers: { cookie: cookieHeader },
          payload: { formKey: "member", label: "Collides With Global", fieldKey, fieldType: "text" },
        });
        expect(response.statusCode).toBe(409);
      } finally {
        await server.close();
      }
    } finally {
      await globalField.cleanup();
    }
  });
});
