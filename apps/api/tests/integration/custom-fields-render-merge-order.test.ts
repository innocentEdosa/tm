import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedGlobalField } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("custom fields: merged render order (spec FR-006/SC-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("orders global fields ahead of tenant fields, each group by displayOrder, with no duplicates", async () => {
    const globalSecond = await seedGlobalField("department", { label: "Global Second", displayOrder: 1 });
    const globalFirst = await seedGlobalField("department", { label: "Global First", displayOrder: 0 });

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };

      await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers,
        payload: { formKey: "department", label: "Tenant First", fieldType: "text" },
      });
      await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers,
        payload: { formKey: "department", label: "Tenant Second", fieldType: "text" },
      });

      const response = await server.inject({
        method: "GET",
        url: "/tenant/form-fields?formKey=department",
        headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const scopes = body.data.map((f: { scope: string }) => f.scope);
      const firstTenantIndex = scopes.indexOf("tenant");
      const lastGlobalIndex = scopes.lastIndexOf("global");
      expect(firstTenantIndex).toBeGreaterThan(lastGlobalIndex);

      const ids = body.data.map((f: { id: string }) => f.id);
      expect(new Set(ids).size).toBe(ids.length);

      const tenantLabels = body.data
        .filter((f: { scope: string }) => f.scope === "tenant")
        .map((f: { label: string }) => f.label);
      expect(tenantLabels).toEqual(["Tenant First", "Tenant Second"]);
    } finally {
      await server.close();
      await globalFirst.cleanup();
      await globalSecond.cleanup();
    }
  });
});
