import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

interface TenantRow {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  isArchived: boolean;
  isPendingDeletion: boolean;
  primaryContactEmail: string;
  createdAt: string;
}

describe("GET /tenants — lists every provisioned tenant for a Super Admin (spec FR-001; SC-001)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns every tenant with its list fields, including both freshly seeded ones", async () => {
    const server = await buildTestServer();
    const tenantAId = randomUUID();
    const tenantBId = randomUUID();
    await seedTenant(tenantAId, `List Test A ${tenantAId}`);
    await seedTenant(tenantBId, `List Test B ${tenantBId}`);
    const { cookieHeader } = await seedSuperAdminSession();

    // Explicit large pageSize: the test DB accumulates tenants across every prior test run, so a
    // default-sized page could miss these two on an old, populous DB — this test only cares that
    // both appear *somewhere*, not that they're first (this is also the regression guard for
    // research.md §8 — it would return an empty/near-empty list with zero of these rows if the
    // super_admin_full_access RLS policy on `tenants` were missing or wrong).
    const response = await server.inject({
      method: "GET",
      url: "/tenants?pageSize=1000",
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { success: boolean; data: { tenants: TenantRow[] } };
    expect(body.success).toBe(true);

    const rowA = body.data.tenants.find((t) => t.id === tenantAId);
    const rowB = body.data.tenants.find((t) => t.id === tenantBId);
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA?.status).toBe("trial");
    expect(rowA?.isArchived).toBe(false);
    expect(rowA?.isPendingDeletion).toBe(false);
    expect(rowA?.subdomain).toBe(`test-${tenantAId}`);
    expect(rowA?.primaryContactEmail).toBe(`contact-${tenantAId}@example.com`);

    await server.close();
  });
});
