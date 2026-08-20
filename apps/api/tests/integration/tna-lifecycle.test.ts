import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

/** Full 5-state lifecycle (draft -> active -> closed -> under_review -> committed), every illegal
 * transition, the reopen endpoint (gap: no reopen existed before), and the commit completeness guard
 * (gap: commit previously succeeded silently with pending assignments outstanding). */
describe("TNA: lifecycle transitions", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedAdminAndDept(tenantId: string) {
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);
    const { deptId, managerId, assistantId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager", email: `manager-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [assistant] = await db
        .insert(users)
        .values({ tenantId, fullName: "Assistant", email: `assistant-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id, assistantManagerId: assistant.id })
        .returning({ id: departments.id });
      return { deptId: dept.id, managerId: manager.id, assistantId: assistant.id };
    });
    return { adminId, deptId, managerId, assistantId };
  }

  it("illegal transitions are rejected with 409 at every state", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { adminId, deptId } = await seedAdminAndDept(tenantId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: {
          title: "Lifecycle Test",
          endDate: "2099-12-31",
          targets: [{ type: "department", departmentId: deptId }],
        },
      });
      const exerciseId = created.json().data.id;

      // Cannot close/begin-review/commit/reopen a draft.
      for (const action of ["close", "begin-review", "commit", "reopen"]) {
        const res = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/${action}`, headers });
        expect(res.statusCode).toBe(409);
      }

      const start = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });
      expect(start.statusCode).toBe(200);
      expect(start.json().data.participantsAssigned).toBe(2);

      // Cannot start again, begin-review, commit, or reopen while active.
      for (const action of ["start", "begin-review", "commit", "reopen"]) {
        const res = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/${action}`, headers });
        expect(res.statusCode).toBe(409);
      }
      // Cannot delete once started.
      const del = await server.inject({ method: "DELETE", url: `/tenant/tna-exercises/${exerciseId}`, headers });
      expect(del.statusCode).toBe(409);
      // Targeting can no longer change once started.
      const patchTargets = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-exercises/${exerciseId}`,
        headers,
        payload: { targetsAllDepartments: true },
      });
      expect(patchTargets.statusCode).toBe(409);
      // But dates/title still can (gap fix: deadline extension).
      const patchDates = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-exercises/${exerciseId}`,
        headers,
        payload: { endDate: "2099-12-30" },
      });
      expect(patchDates.statusCode).toBe(200);
      expect(patchDates.json().data.id).toBe(exerciseId);

      const close = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/close`, headers });
      expect(close.statusCode).toBe(200);

      // Cannot close again, start, or commit while closed.
      for (const action of ["close", "start", "commit"]) {
        const res = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/${action}`, headers });
        expect(res.statusCode).toBe(409);
      }

      const beginReview = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/begin-review`, headers });
      expect(beginReview.statusCode).toBe(200);

      // Cannot reopen, close, or begin-review again while under_review.
      for (const action of ["reopen", "close", "begin-review"]) {
        const res = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/${action}`, headers });
        expect(res.statusCode).toBe(409);
      }

      const commit = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/commit`,
        headers,
        payload: { confirmDespitePending: true },
      });
      expect(commit.statusCode).toBe(200);

      // Nothing is legal once committed, including edits.
      for (const action of ["start", "close", "begin-review", "commit", "reopen"]) {
        const res = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/${action}`, headers });
        expect(res.statusCode).toBe(409);
      }
      const patchAfterCommit = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-exercises/${exerciseId}`,
        headers,
        payload: { title: "Should not work" },
      });
      expect(patchAfterCommit.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  // Regression: participants must be visible as soon as targets are set (create/edit), not only
  // after Start — the admin previewing a still-draft exercise should never see "0 participants"
  // when it has real targets that resolve to real people (bug report: "I selected a department and
  // a user but I still see zero participant").
  it("participants are resolved immediately on create and kept in sync on edit, before Start is ever clicked", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { adminId, deptId, managerId, assistantId } = await seedAdminAndDept(tenantId);
    const directUserId = randomUUID();
    await seedUser(tenantId, directUserId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: {
          title: "Draft Preview Test",
          endDate: "2099-12-31",
          targets: [
            { type: "department", departmentId: deptId },
            { type: "user", userId: directUserId },
          ],
        },
      });
      expect(created.statusCode).toBe(201);
      const exerciseId = created.json().data.id;

      const detail = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}`, headers });
      expect(detail.json().data.status).toBe("draft");
      expect(detail.json().data.progress.assigned).toBe(3);

      const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      const assignedUserIds = assignments.json().data.map((a: { userId: string }) => a.userId).sort();
      expect(assignedUserIds).toEqual([directUserId, managerId, assistantId].sort());

      // Editing targets while still draft re-syncs the roster, not just appends to it.
      const patched = await server.inject({
        method: "PATCH",
        url: `/tenant/tna-exercises/${exerciseId}`,
        headers,
        payload: { targets: [{ type: "user", userId: directUserId }] },
      });
      expect(patched.statusCode).toBe(200);
      const afterPatch = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}`, headers });
      expect(afterPatch.json().data.progress.assigned).toBe(1);

      // Start still works and notifies the (now single) already-resolved participant.
      const start = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });
      expect(start.statusCode).toBe(200);
      expect(start.json().data.participantsAssigned).toBe(1);
    } finally {
      await server.close();
    }
  });

  // Regression: a participant's own assignment must stay completely invisible to them — not listed,
  // not directly fetchable — until HR actually clicks Start, even though the assignment row itself
  // now exists from the moment targets are set (see the sync test above). Draft is an admin-only
  // preview state.
  it("a participant cannot see or open their own assignment while the exercise is still draft", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { adminId, deptId, managerId } = await seedAdminAndDept(tenantId);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers: adminHeaders,
        payload: { title: "Not Started Yet", endDate: "2099-12-31", targets: [{ type: "department", departmentId: deptId }] },
      });
      const exerciseId = created.json().data.id;

      const assignmentsAsAdmin = await server.inject({
        method: "GET",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers: adminHeaders,
      });
      const assignmentId = assignmentsAsAdmin.json().data.find((a: { userId: string }) => a.userId === managerId).id;

      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const mine = await server.inject({ method: "GET", url: "/tenant/my-tna-assignments", headers: managerHeaders });
      expect(mine.json().data).toEqual([]);

      const detail = await server.inject({
        method: "GET",
        url: `/tenant/tna-assignments/${assignmentId}`,
        headers: managerHeaders,
      });
      expect(detail.statusCode).toBe(404);

      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers: adminHeaders });

      const mineAfterStart = await server.inject({ method: "GET", url: "/tenant/my-tna-assignments", headers: managerHeaders });
      expect(mineAfterStart.json().data).toHaveLength(1);

      const detailAfterStart = await server.inject({
        method: "GET",
        url: `/tenant/tna-assignments/${assignmentId}`,
        headers: managerHeaders,
      });
      expect(detailAfterStart.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("reopen restores an early-closed exercise back to active", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { adminId, deptId } = await seedAdminAndDept(tenantId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: {
          title: "Reopen Test",
          endDate: "2099-12-31",
          targets: [{ type: "department", departmentId: deptId }],
        },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });
      const close = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/close`, headers });
      expect(close.statusCode).toBe(200);

      const reopen = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/reopen`, headers });
      expect(reopen.statusCode).toBe(200);

      const detail = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}`, headers });
      expect(detail.json().data.status).toBe("active");
      expect(detail.json().data.closedAt).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("commit is rejected with a pending count unless confirmed, and succeeds outright once nothing is pending", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { adminId, deptId, managerId } = await seedAdminAndDept(tenantId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: {
          title: "Commit Guard Test",
          endDate: "2099-12-31",
          targets: [{ type: "department", departmentId: deptId }],
        },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });

      const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      const managerAssignment = assignments.json().data.find((a: { userId: string }) => a.userId === managerId);

      // Manager submits their own response; the assistant's stays pending.
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const submit = await server.inject({
        method: "POST",
        url: `/tenant/tna-assignments/${managerAssignment.id}/submit`,
        headers: managerHeaders,
        payload: { values: { skill_gaps: "Needs Excel training", priority: "High" } },
      });
      expect(submit.statusCode).toBe(200);

      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/close`, headers });
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/begin-review`, headers });

      const commitWithoutConfirm = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/commit`,
        headers,
      });
      expect(commitWithoutConfirm.statusCode).toBe(409);
      const body = commitWithoutConfirm.json();
      expect(body.code).toBe("PENDING_ASSIGNMENTS");
      expect(body.pendingCount).toBe(1);
      expect(body.assignedCount).toBe(2);

      const commitConfirmed = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/commit`,
        headers,
        payload: { confirmDespitePending: true },
      });
      expect(commitConfirmed.statusCode).toBe(200);

      const detail = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}`, headers });
      expect(detail.json().data.status).toBe("committed");
    } finally {
      await server.close();
    }
  });

  it("commit succeeds directly, no confirmation needed, once every assignment is submitted", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { adminId, deptId, managerId, assistantId } = await seedAdminAndDept(tenantId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: {
          title: "All Submitted Test",
          endDate: "2099-12-31",
          targets: [{ type: "department", departmentId: deptId }],
        },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });

      const assignments = (await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers })).json()
        .data;
      for (const [userId, assignment] of [
        [managerId, assignments.find((a: { userId: string }) => a.userId === managerId)],
        [assistantId, assignments.find((a: { userId: string }) => a.userId === assistantId)],
      ] as const) {
        const submit = await server.inject({
          method: "POST",
          url: `/tenant/tna-assignments/${assignment.id}/submit`,
          headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
          payload: { values: { skill_gaps: "Gap", priority: "Low" } },
        });
        expect(submit.statusCode).toBe(200);
      }

      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/close`, headers });
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/begin-review`, headers });
      const commit = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/commit`, headers });
      expect(commit.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
