import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/**
 * Consolidated SC-003/SC-004 sweep across all 9 course-content endpoints — mirrors spec 023's
 * `course-cross-tenant-isolation.test.ts` polish-phase pattern. Individual story test files already
 * cover a representative subset of these cases; this file exists to confirm every single endpoint,
 * not just a sample, rejects a cross-tenant id (404) and a caller lacking the relevant permission
 * (403).
 */
describe("course content: tenant isolation and permission gating (SC-003/SC-004)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function setupFixture() {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);
    const noPermId = randomUUID();
    await seedUser(tenantId, noPermId);
    await seedUserWithRole(tenantId, noPermId, []);

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherUserId = randomUUID();
    await seedUser(otherTenantId, otherUserId);
    await seedUserWithRole(otherTenantId, otherUserId, ["course.manage"]);

    return { tenantId, managerId, noPermId, otherTenantId, otherUserId };
  }

  it("rejects every endpoint for a cross-tenant id (404) and a caller lacking the relevant permission (403)", async () => {
    const { tenantId, managerId, noPermId, otherTenantId, otherUserId } = await setupFixture();

    const server = await buildTestServer();
    try {
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const noPermHeaders = { "x-test-user-id": noPermId, "x-test-tenant-id": tenantId };
      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };

      const course = (
        await server.inject({
          method: "POST",
          url: "/tenant/courses",
          headers: managerHeaders,
          payload: { title: `Course ${randomUUID()}`, category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
        })
      ).json().data;
      const module = (await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules`, headers: managerHeaders, payload: { title: "M" } })).json().data;
      const item = (
        await server.inject({
          method: "POST",
          url: `/tenant/modules/${module.id}/content-items`,
          headers: managerHeaders,
          payload: { type: "article", title: "I", payload: { body: "x" } },
        })
      ).json().data;

      // GET curriculum
      expect((await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers: otherHeaders })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers: noPermHeaders })).statusCode).toBe(403);

      // POST module
      expect((await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules`, headers: otherHeaders, payload: { title: "X" } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules`, headers: noPermHeaders, payload: { title: "X" } })).statusCode).toBe(403);

      // PATCH module
      expect((await server.inject({ method: "PATCH", url: `/tenant/modules/${module.id}`, headers: otherHeaders, payload: { title: "X" } })).statusCode).toBe(404);
      expect((await server.inject({ method: "PATCH", url: `/tenant/modules/${module.id}`, headers: noPermHeaders, payload: { title: "X" } })).statusCode).toBe(403);

      // POST modules/reorder
      expect((await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules/reorder`, headers: otherHeaders, payload: { moduleIds: [] } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules/reorder`, headers: noPermHeaders, payload: { moduleIds: [] } })).statusCode).toBe(403);

      // POST content-items
      expect(
        (
          await server.inject({
            method: "POST",
            url: `/tenant/modules/${module.id}/content-items`,
            headers: otherHeaders,
            payload: { type: "article", title: "X", payload: { body: "x" } },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await server.inject({
            method: "POST",
            url: `/tenant/modules/${module.id}/content-items`,
            headers: noPermHeaders,
            payload: { type: "article", title: "X", payload: { body: "x" } },
          })
        ).statusCode,
      ).toBe(403);

      // PATCH content-item
      expect((await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers: otherHeaders, payload: { title: "X" } })).statusCode).toBe(404);
      expect((await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers: noPermHeaders, payload: { title: "X" } })).statusCode).toBe(403);

      // POST content-items/reorder
      expect((await server.inject({ method: "POST", url: `/tenant/modules/${module.id}/content-items/reorder`, headers: otherHeaders, payload: { contentItemIds: [] } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url: `/tenant/modules/${module.id}/content-items/reorder`, headers: noPermHeaders, payload: { contentItemIds: [] } })).statusCode).toBe(403);

      // DELETE content-item and DELETE module — run last since they mutate state
      expect((await server.inject({ method: "DELETE", url: `/tenant/content-items/${item.id}`, headers: otherHeaders })).statusCode).toBe(404);
      expect((await server.inject({ method: "DELETE", url: `/tenant/content-items/${item.id}`, headers: noPermHeaders })).statusCode).toBe(403);
      expect((await server.inject({ method: "DELETE", url: `/tenant/modules/${module.id}`, headers: otherHeaders })).statusCode).toBe(404);
      expect((await server.inject({ method: "DELETE", url: `/tenant/modules/${module.id}`, headers: noPermHeaders })).statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
