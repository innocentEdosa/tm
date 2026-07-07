import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { users } from "../../src/db/schema/users";

describe("GET /tenant/team — no department assigned (spec 012 US2 edge case)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns an empty list with reason: no_department_assigned for a team.view.department holder with no department", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = await withTenantDb(tenantId, async (db) => {
      const [viewer] = await db
        .insert(users)
        .values({ tenantId, fullName: "No Dept Viewer", email: `no-dept-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return viewer.id;
    });
    await seedUserWithRole(tenantId, viewerId, ["team.view.department"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
      expect(body.meta.reason).toBe("no_department_assigned");
    } finally {
      await server.close();
    }
  });
});
