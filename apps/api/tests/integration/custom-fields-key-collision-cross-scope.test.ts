import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedGlobalField } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("custom fields: field-key collision across global and tenant scopes (spec FR-005/SC-003)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects a tenant field whose key collides with an existing global field's key", async () => {
    const globalFieldKey = `external_ref_${randomUUID().slice(0, 8)}`;
    const global = await seedGlobalField("department", { fieldKey: globalFieldKey, label: "External Reference" });

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { formKey: "department", label: "Something Else", fieldKey: globalFieldKey, fieldType: "text" },
      });
      expect(response.statusCode).toBe(409);
    } finally {
      await server.close();
      await global.cleanup();
    }
  });

  it("rejects a tenant field whose key collides with one of the tenant's own existing fields", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };

      const first = await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers,
        payload: { formKey: "department", label: "Cost Center", fieldType: "text" },
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers,
        payload: { formKey: "department", label: "Cost Center", fieldType: "text" },
      });
      expect(second.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });
});
