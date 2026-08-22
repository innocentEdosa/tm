import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

/** Mid-campaign roster remediation (gap fix): HR adding a missed participant or removing one added in
 * error, after an exercise has already started. Only meaningful once a roster exists (active/closed/
 * under_review) and before the exercise is committed; only a still-pending assignment may be removed. */
describe("TNA: mid-campaign participant remediation", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("cannot add a participant before Start (no roster exists yet)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);
    const targetUserId = randomUUID();
    await seedUser(tenantId, targetUserId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Draft Exercise", endDate: "2099-12-31", targetsAllDepartments: true },
      });
      const exerciseId = created.json().data.id;

      const add = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers,
        payload: { userId: targetUserId },
      });
      expect(add.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("adds a participant while active, rejects duplicates and archived users, and removal only works while pending", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const { missedUserId, archivedUserId } = await withTenantDb(tenantId, async (db) => {
      const [missed] = await db.insert(users).values({ tenantId, fullName: "Missed Person", email: `missed-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [archived] = await db
        .insert(users)
        .values({ tenantId, fullName: "Archived Person", email: `arch-${randomUUID()}@example.com`, archivedAt: new Date() })
        .returning({ id: users.id });
      return { missedUserId: missed.id, archivedUserId: archived.id };
    });

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Active Exercise", endDate: "2099-12-31", targetsAllDepartments: true },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });

      const addArchived = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers,
        payload: { userId: archivedUserId },
      });
      expect(addArchived.statusCode).toBe(422);

      const add = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers,
        payload: { userId: missedUserId },
      });
      expect(add.statusCode).toBe(201);
      const assignmentId = add.json().data.id;

      const addDuplicate = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers,
        payload: { userId: missedUserId },
      });
      expect(addDuplicate.statusCode).toBe(409);

      const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      expect(assignments.json().data.map((a: { id: string }) => a.id)).toContain(assignmentId);

      // Submit it, then confirm it can no longer be removed.
      const missedHeaders = { "x-test-user-id": missedUserId, "x-test-tenant-id": tenantId };
      const started = await server.inject({ method: "POST", url: `/tenant/tna-assignments/${assignmentId}/responses`, headers: missedHeaders });
      const responseId = started.json().data.id;
      const submit = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${assignmentId}/responses/${responseId}/submit`,
        headers: missedHeaders,
        payload: { values: { skill_gaps: "Gap", priority: "Low" } },
      });
      expect(submit.statusCode).toBe(200);

      const removeSubmitted = await server.inject({ method: "DELETE", url: `/tenant/tna-assignments/${assignmentId}`, headers });
      expect(removeSubmitted.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("removes a still-pending assignment", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const { deptId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db.insert(users).values({ tenantId, fullName: "Manager", email: `m-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [dept] = await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id }).returning({ id: departments.id });
      return { deptId: dept.id };
    });

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Removal Test", endDate: "2099-12-31", targets: [{ type: "department", departmentId: deptId }] },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });

      const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      const assignmentId = assignments.json().data[0].id;

      const remove = await server.inject({ method: "DELETE", url: `/tenant/tna-assignments/${assignmentId}`, headers });
      expect(remove.statusCode).toBe(204);

      const after = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      expect(after.json().data.map((a: { id: string }) => a.id)).not.toContain(assignmentId);
    } finally {
      await server.close();
    }
  });

  it("cannot add or remove participants once the exercise is committed", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);
    const extraUserId = randomUUID();
    await seedUser(tenantId, extraUserId);

    const { deptId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db.insert(users).values({ tenantId, fullName: "Manager", email: `m-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [dept] = await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id }).returning({ id: departments.id });
      return { deptId: dept.id };
    });

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Committed Test", endDate: "2099-12-31", targets: [{ type: "department", departmentId: deptId }] },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/close`, headers });
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/begin-review`, headers });
      await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/commit`,
        headers,
        payload: { confirmDespitePending: true },
      });

      const add = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers,
        payload: { userId: extraUserId },
      });
      expect(add.statusCode).toBe(409);

      const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      const assignmentId = assignments.json().data[0].id;
      const remove = await server.inject({ method: "DELETE", url: `/tenant/tna-assignments/${assignmentId}`, headers });
      expect(remove.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });
});
