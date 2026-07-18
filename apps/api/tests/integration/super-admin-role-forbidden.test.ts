import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("/tenants/:id/roles(/:roleId) — forbidden without a Super Admin session (spec FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("401s POST/PATCH/DELETE without any session", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const server = await buildTestServer();
    try {
      const post = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/roles`,
        payload: { name: "X" },
      });
      expect(post.statusCode).toBe(401);

      const patch = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/roles/${roleId}`,
        payload: { name: "X" },
      });
      expect(patch.statusCode).toBe(401);

      const del = await server.inject({ method: "DELETE", url: `/tenants/${tenantId}/roles/${roleId}` });
      expect(del.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("401s with a tenant-user session instead of a Super Admin one", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/roles/${roleId}`,
        headers: { "x-test-user-id": randomUUID(), "x-test-tenant-id": tenantId },
        payload: { name: "X" },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
