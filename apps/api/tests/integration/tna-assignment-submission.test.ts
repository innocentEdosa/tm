import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

/** Save-progress / submit behavior on a participant's own `tna_assignments` row: required-field
 * validation, duplicate-submission prevention, and deadline enforcement (an exercise past its
 * `endDate` — or not `active` at all — must reject both save and submit). */
describe("TNA: assignment save/submit", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedActiveExercise(server: FastifyInstance, tenantId: string, adminId: string, endDate: string) {
    const { deptId, managerId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db.insert(users).values({ tenantId, fullName: "Manager", email: `m-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [dept] = await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id }).returning({ id: departments.id });
      return { deptId: dept.id, managerId: manager.id };
    });
    const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
    const created = await server.inject({
      method: "POST",
      url: "/tenant/tna-exercises",
      headers: adminHeaders,
      payload: { title: "Submission Test", endDate, targets: [{ type: "department", departmentId: deptId }] },
    });
    const exerciseId = created.json().data.id;
    await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers: adminHeaders });
    const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers: adminHeaders });
    const assignmentId = assignments.json().data.find((a: { userId: string }) => a.userId === managerId).id;
    return { assignmentId, managerId, exerciseId };
  }

  it("save-progress persists without validation; submit enforces required fields", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const server = await buildTestServer();
    try {
      const { assignmentId, managerId } = await seedActiveExercise(server, tenantId, adminId, "2099-12-31");
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };

      const saveDraft = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-assignments/${assignmentId}`,
        headers,
        payload: { values: { skill_gaps: "" } },
      });
      expect(saveDraft.statusCode).toBe(200);

      const missingRequired = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${assignmentId}/submit`,
        headers,
        payload: { values: {} },
      });
      expect(missingRequired.statusCode).toBe(422);
      expect(missingRequired.json().errors.length).toBeGreaterThan(0);

      const submit = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${assignmentId}/submit`,
        headers,
        payload: { values: { skill_gaps: "Needs Excel training", priority: "High" } },
      });
      expect(submit.statusCode).toBe(200);

      // Cannot submit twice.
      const secondSubmit = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${assignmentId}/submit`,
        headers,
        payload: { values: { skill_gaps: "Different answer", priority: "Low" } },
      });
      expect(secondSubmit.statusCode).toBe(409);

      // Cannot edit further via save-progress once submitted, either.
      const editAfterSubmit = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-assignments/${assignmentId}`,
        headers,
        payload: { values: { skill_gaps: "Trying to change it" } },
      });
      expect(editAfterSubmit.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("rejects submission once the exercise's end date has passed", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const server = await buildTestServer();
    try {
      const { assignmentId, managerId } = await seedActiveExercise(server, tenantId, adminId, "2020-01-02");
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const submit = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${assignmentId}/submit`,
        headers,
        payload: { values: { skill_gaps: "Late submission", priority: "Low" } },
      });
      expect(submit.statusCode).toBe(409);
      expect(submit.json().message).toMatch(/not currently accepting responses/);

      const save = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-assignments/${assignmentId}`,
        headers,
        payload: { values: { skill_gaps: "Late save" } },
      });
      expect(save.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("rejects submission once the exercise has been closed, even before the end date", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const server = await buildTestServer();
    try {
      const { assignmentId, managerId, exerciseId } = await seedActiveExercise(server, tenantId, adminId, "2099-12-31");
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const close = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/close`, headers: adminHeaders });
      expect(close.statusCode).toBe(200);

      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const submit = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${assignmentId}/submit`,
        headers,
        payload: { values: { skill_gaps: "Too late", priority: "Low" } },
      });
      expect(submit.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });
});
