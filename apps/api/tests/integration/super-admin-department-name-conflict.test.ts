import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("Department name uniqueness on POST /tenants/:id/departments (spec FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("409s on a case-insensitive duplicate name within the same tenant; the same name at a different tenant succeeds", async () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(tenantId);
    await seedTenant(otherTenantId);
    const name = `Engineering ${randomUUID()}`;
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const first = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
        payload: { name },
      });
      expect(first.statusCode).toBe(201);

      const dup = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
        payload: { name: name.toUpperCase() },
      });
      expect(dup.statusCode).toBe(409);

      const otherTenant = await server.inject({
        method: "POST",
        url: `/tenants/${otherTenantId}/departments`,
        headers: { cookie: cookieHeader },
        payload: { name },
      });
      expect(otherTenant.statusCode).toBe(201);
    } finally {
      await server.close();
    }
  });
});
