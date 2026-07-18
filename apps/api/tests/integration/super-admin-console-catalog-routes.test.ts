import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("Console catalog GET routes added to support the Roles/Forms tabs (spec FR-004/FR-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("GET /tenants/:id/permission-catalog excludes the platform category", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/permission-catalog`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      const keys = response.json().data.map((p: { key: string }) => p.key);
      expect(keys).not.toContain("view_permission_catalog");
      expect(keys.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it("GET /tenants/:id/form-definitions lists the registered form types", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/form-definitions`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      const keys = response.json().data.map((f: { key: string }) => f.key);
      expect(keys).toContain("member");
      expect(keys).toContain("department");
    } finally {
      await server.close();
    }
  });

  it("GET /tenants/:id/custom-fields?formKey=member lists that tenant's merged field set", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const createResponse = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/custom-fields`,
        headers: { cookie: cookieHeader },
        payload: { formKey: "member", label: `List Field ${randomUUID()}`, fieldType: "text" },
      });
      expect(createResponse.statusCode).toBe(201);

      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/custom-fields?formKey=member`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      const ids = response.json().data.map((f: { id: string }) => f.id);
      expect(ids).toContain(createResponse.json().data.id);
    } finally {
      await server.close();
    }
  });

  it("400s GET /tenants/:id/custom-fields without formKey", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenants/${tenantId}/custom-fields`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });
});
