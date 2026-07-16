import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("GET /tenants — search (Super Admin Tenant Console spec)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("matches by company name, case-insensitively, and excludes non-matching tenants", async () => {
    const server = await buildTestServer();
    try {
      const unique = randomUUID();
      const matchId = randomUUID();
      const otherId = randomUUID();
      await seedTenant(matchId, `Findable Search Co ${unique}`);
      await seedTenant(otherId, `Unrelated Tenant ${randomUUID()}`);
      const { cookieHeader } = await seedSuperAdminSession();

      const response = await server.inject({
        method: "GET",
        url: `/tenants?search=${encodeURIComponent(`findable search co ${unique}`.toLowerCase())}`,
        headers: { cookie: cookieHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { tenants: { id: string }[] } };
      const ids = body.data.tenants.map((t) => t.id);
      expect(ids).toContain(matchId);
      expect(ids).not.toContain(otherId);
    } finally {
      await server.close();
    }
  });

  it("matches by subdomain", async () => {
    const server = await buildTestServer();
    try {
      const tenantId = randomUUID();
      await seedTenant(tenantId);

      const { cookieHeader } = await seedSuperAdminSession();
      const response = await server.inject({
        method: "GET",
        url: `/tenants?search=test-${tenantId}`,
        headers: { cookie: cookieHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { tenants: { id: string }[] } };
      expect(body.data.tenants.map((t) => t.id)).toContain(tenantId);
    } finally {
      await server.close();
    }
  });
});
