import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { trainingNeeds } from "../../src/db/schema/training-needs";

describe("training needs: approval workflow (tna.approve, separate from tna.manage.*)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("a pure tna.approve holder (no view/manage) can find and approve a submitted entry, and creator/approver names resolve", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { deptId, managerId, approverId } = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId, name: `Security ${randomUUID()}` }).returning({ id: departments.id });
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Dept Manager", email: `mgr-${randomUUID()}@example.com`, departmentId: dept.id })
        .returning({ id: users.id });
      const [approverUser] = await db
        .insert(users)
        .values({ tenantId, fullName: "Pure Approver", email: `approver-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return { deptId: dept.id, managerId: manager.id, approverId: approverUser.id };
    });
    // Deliberately only tna.approve — no view.all/view.department/manage.all/manage.department —
    // proves the permission is genuinely usable on its own, not just additive to manage.all.
    await seedUserWithRole(tenantId, approverId, ["tna.approve"]);

    const { trainingNeedId } = await withTenantDb(tenantId, async (db) => {
      const [entry] = await db
        .insert(trainingNeeds)
        .values({
          tenantId,
          departmentId: deptId,
          title: "Data Protection Training",
          priority: "medium",
          status: "submitted",
          createdByUserId: managerId,
          submittedAt: new Date(),
        })
        .returning({ id: trainingNeeds.id });
      return { trainingNeedId: entry.id };
    });

    const server = await buildTestServer();
    try {
      const approverHeaders = { "x-test-user-id": approverId, "x-test-tenant-id": tenantId };

      // Discoverable via the list — not just reachable if you already know the id.
      const list = await server.inject({ method: "GET", url: "/tenant/training-needs", headers: approverHeaders });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.map((r: { id: string }) => r.id)).toContain(trainingNeedId);

      const detail = await server.inject({
        method: "GET",
        url: `/tenant/training-needs/${trainingNeedId}`,
        headers: approverHeaders,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.createdByName).toBe("Dept Manager");

      const approve = await server.inject({
        method: "POST",
        url: `/tenant/training-needs/${trainingNeedId}/approve`,
        headers: approverHeaders,
      });
      expect(approve.statusCode).toBe(200);
      expect(approve.json().data.status).toBe("approved");
      expect(approve.json().data.approvedByName).toBe("Pure Approver");
      expect(approve.json().data.approvedAt).not.toBeNull();

      // Approving again (no-op) succeeds and doesn't error, preserving the original approver.
      const approveAgain = await server.inject({
        method: "POST",
        url: `/tenant/training-needs/${trainingNeedId}/approve`,
        headers: approverHeaders,
      });
      expect(approveAgain.statusCode).toBe(200);
      expect(approveAgain.json().data.approvedByName).toBe("Pure Approver");

      // An approved entry stays visible in the org-wide list (not hidden the way a Draft is).
      const listAfter = await server.inject({ method: "GET", url: "/tenant/training-needs", headers: approverHeaders });
      expect(listAfter.json().data.map((r: { id: string }) => r.id)).toContain(trainingNeedId);
    } finally {
      await server.close();
    }
  });

  it("rejects approving a Draft (409), and rejects a caller without tna.approve (403)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { deptId, approverId, managerId } = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId, name: `Ops ${randomUUID()}` }).returning({ id: departments.id });
      const [approverUser] = await db
        .insert(users)
        .values({ tenantId, fullName: "Approver", email: `approver-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager", email: `mgr-${randomUUID()}@example.com`, departmentId: dept.id })
        .returning({ id: users.id });
      return { deptId: dept.id, approverId: approverUser.id, managerId: manager.id };
    });
    await seedUserWithRole(tenantId, approverId, ["tna.approve"]);
    await seedUserWithRole(tenantId, managerId, ["tna.view.department", "tna.manage.department"]);

    const { draftId } = await withTenantDb(tenantId, async (db) => {
      const [entry] = await db
        .insert(trainingNeeds)
        .values({ tenantId, departmentId: deptId, title: "Draft need", priority: "low", status: "draft" })
        .returning({ id: trainingNeeds.id });
      return { draftId: entry.id };
    });

    const server = await buildTestServer();
    try {
      const approveDraft = await server.inject({
        method: "POST",
        url: `/tenant/training-needs/${draftId}/approve`,
        headers: { "x-test-user-id": approverId, "x-test-tenant-id": tenantId },
      });
      expect(approveDraft.statusCode).toBe(409);

      // The manager holds tna.manage.department (can edit/submit) but not tna.approve — approving
      // is a distinct, deliberately separate permission (spec follow-up).
      const managerTriesApprove = await server.inject({
        method: "POST",
        url: `/tenant/training-needs/${draftId}/approve`,
        headers: { "x-test-user-id": managerId, "x-test-tenant-id": tenantId },
      });
      expect(managerTriesApprove.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
