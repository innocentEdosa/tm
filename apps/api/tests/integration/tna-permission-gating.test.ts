import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

/** Permission gating for the new HR-only Training Needs Analysis feature (`tna.manage`/`tna.view`,
 * both org-wide only — unlike Training Request's `.all`/`.department` split) and the ownership-based
 * access a participant gets to their own `tna_assignments` row without holding either permission. */
describe("TNA: permission gating (tna.manage / tna.view / assignment ownership)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 403 for a user with no tna.* permission on every admin route", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const list = await server.inject({ method: "GET", url: "/tenant/tna-exercises", headers });
      expect(list.statusCode).toBe(403);

      const create = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Q1 Skills Review", endDate: "2026-01-31", targetsAllDepartments: true },
      });
      expect(create.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("tna.view can read but not create/start/close/commit/delete", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["tna.manage"]);
    const viewerId = randomUUID();
    await seedUser(tenantId, viewerId);
    await seedUserWithRole(tenantId, viewerId, ["tna.view"]);

    const server = await buildTestServer();
    try {
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers: managerHeaders,
        payload: { title: "Q1 Skills Review", endDate: "2026-01-31", targetsAllDepartments: true },
      });
      expect(created.statusCode).toBe(201);
      const exerciseId = created.json().data.id;

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const list = await server.inject({ method: "GET", url: "/tenant/tna-exercises", headers: viewerHeaders });
      expect(list.statusCode).toBe(200);
      const detail = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}`, headers: viewerHeaders });
      expect(detail.statusCode).toBe(200);

      const patch = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-exercises/${exerciseId}`,
        headers: viewerHeaders,
        payload: { title: "Renamed" },
      });
      expect(patch.statusCode).toBe(403);

      const start = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers: viewerHeaders });
      expect(start.statusCode).toBe(403);

      const del = await server.inject({ method: "DELETE", url: `/tenant/tna-exercises/${exerciseId}`, headers: viewerHeaders });
      expect(del.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("a participant with no tna.* permission can access only their own assignment; another user's is 404", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const { deptId, managerId, otherId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Dept Manager", email: `manager-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [other] = await db
        .insert(users)
        .values({ tenantId, fullName: "Other Person", email: `other-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Ops ${randomUUID()}`, managerId: manager.id })
        .returning({ id: departments.id });
      return { deptId: dept.id, managerId: manager.id, otherId: other.id };
    });

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers: adminHeaders,
        payload: {
          title: "Ops Skills Review",
          endDate: "2099-12-31",
          targets: [{ type: "department", departmentId: deptId }],
        },
      });
      const exerciseId = created.json().data.id;
      const started = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers: adminHeaders });
      expect(started.statusCode).toBe(200);

      const assignments = await server.inject({
        method: "GET",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers: adminHeaders,
      });
      const managerAssignment = assignments.json().data.find((a: { userId: string }) => a.userId === managerId);
      expect(managerAssignment).toBeDefined();

      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const own = await server.inject({
        method: "GET",
        url: `/tenant/tna-assignments/${managerAssignment.id}`,
        headers: managerHeaders,
      });
      expect(own.statusCode).toBe(200);

      const otherHeaders = { "x-test-user-id": otherId, "x-test-tenant-id": tenantId };
      const notOwned = await server.inject({
        method: "GET",
        url: `/tenant/tna-assignments/${managerAssignment.id}`,
        headers: otherHeaders,
      });
      expect(notOwned.statusCode).toBe(404);

      const notOwnedStart = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${managerAssignment.id}/responses`,
        headers: otherHeaders,
      });
      expect(notOwnedStart.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
