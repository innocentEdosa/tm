import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/**
 * SC-003: cross-tenant rejection across every mutating endpoint. Update's own cross-tenant case is
 * already covered by course-update-and-transitions.test.ts — this file scopes to archive (analyze
 * report finding D1), the one mutating endpoint not otherwise covered.
 */
describe("course cross-tenant isolation (spec SC-003, FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 404 when archiving a course id belonging to a different tenant", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherUserId = randomUUID();
    await seedUser(otherTenantId, otherUserId);
    await seedUserWithRole(otherTenantId, otherUserId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: {
          title: "Protected Course",
          category: "Technical",
          deliveryMode: "virtual",
          duration: { value: 1, unit: "hours" },
        },
      });
      const courseId = created.json().data.id;

      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const response = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/archive`, headers: otherHeaders });
      expect(response.statusCode).toBe(404);

      // The course must remain untouched in its own tenant.
      const stillThere = await server.inject({ method: "GET", url: `/tenant/courses/${courseId}`, headers });
      expect(stillThere.json().data.status).toBe("draft");
    } finally {
      await server.close();
    }
  });
});
