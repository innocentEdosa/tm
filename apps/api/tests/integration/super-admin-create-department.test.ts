import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { departments } from "../../src/db/schema/departments";

describe("POST /tenants/:id/departments (spec FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a department scoped to the tenant", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
        payload: { name: `Console Dept ${randomUUID()}` },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(departments).where(eq(departments.id, body.data.id)),
      );
      expect(row.tenantId).toBe(tenantId);
      expect(row.status).toBe("active");
    } finally {
      await server.close();
    }
  });

  it("400s when name is missing", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/departments`,
        headers: { cookie: cookieHeader },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });
});
