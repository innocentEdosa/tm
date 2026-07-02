import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool } from "../helpers/pg";
import { seedUserWithRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

function validBody(subdomain: string) {
  return {
    company: {
      name: "Acme Corp",
      subdomain,
      primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
    },
    admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
  };
}

describe("POST /provisioning/tenants — forbidden for non-Super-Admin callers", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 403 for an authenticated user who is not the platform Super Admin", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    const userId = randomUUID();
    // A regular tenant-scoped user with every catalog permission except provision_tenant (which is
    // platform-only and not grantable to a tenant role at all).
    await seedUserWithRole(tenantId, userId, [
      "approve_enrollment",
      "edit_content_library",
      "view_department_analytics",
      "manage_roles",
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      payload: validBody(`acme-${randomUUID()}`),
    });

    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it("returns 403 for an unauthenticated caller", async () => {
    const server = await buildTestServer();

    const response = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      payload: validBody(`acme-${randomUUID()}`),
    });

    expect(response.statusCode).toBe(403);
    await server.close();
  });
});
