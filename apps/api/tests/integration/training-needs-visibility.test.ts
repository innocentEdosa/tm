import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { trainingNeeds } from "../../src/db/schema/training-needs";

describe("training needs: org-wide vs department-scoped visibility (spec 014 US2, Clarifications Q1/Q3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("tna.view.all sees only Submitted entries across every department — Drafts stay private", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { deptAId, deptBId, hrAdminId } = await withTenantDb(tenantId, async (db) => {
      const [deptA] = await db.insert(departments).values({ tenantId, name: `A ${randomUUID()}` }).returning({ id: departments.id });
      const [deptB] = await db.insert(departments).values({ tenantId, name: `B ${randomUUID()}` }).returning({ id: departments.id });
      const [hrAdmin] = await db
        .insert(users)
        .values({ tenantId, fullName: "HR Admin", email: `hr-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return { deptAId: deptA.id, deptBId: deptB.id, hrAdminId: hrAdmin.id };
    });
    await seedUserWithRole(tenantId, hrAdminId, ["tna.view.all", "tna.manage.all"]);

    const { submittedAId, draftBId } = await withTenantDb(tenantId, async (db) => {
      const [submittedA] = await db
        .insert(trainingNeeds)
        .values({ tenantId, departmentId: deptAId, title: "Submitted in A", priority: "high", status: "submitted", submittedAt: new Date() })
        .returning({ id: trainingNeeds.id });
      const [draftB] = await db
        .insert(trainingNeeds)
        .values({ tenantId, departmentId: deptBId, title: "Draft in B", priority: "low", status: "draft" })
        .returning({ id: trainingNeeds.id });
      return { submittedAId: submittedA.id, draftBId: draftB.id };
    });

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": hrAdminId, "x-test-tenant-id": tenantId };

      const list = await server.inject({ method: "GET", url: "/tenant/training-needs", headers });
      expect(list.statusCode).toBe(200);
      const ids = list.json().data.map((row: { id: string }) => row.id);
      expect(ids).toContain(submittedAId);
      expect(ids).not.toContain(draftBId);
      expect(list.json().pagination).toBeDefined();

      // tna.manage.all can view/edit the Draft directly by id (manage scope, not view scope) —
      // confirms the org-wide LIST hiding a Draft is a view-scope rule, not a blanket "HR can never
      // touch a Draft" rule. GET-by-id must succeed even though the LIST above correctly omitted it
      // — otherwise a manage.all caller could PATCH a Draft blind but never load it in the UI first
      // (regression: this 404'd before the GET detail route also checked tna.manage.all).
      const getDraft = await server.inject({ method: "GET", url: `/tenant/training-needs/${draftBId}`, headers });
      expect(getDraft.statusCode).toBe(200);
      expect(getDraft.json().data.status).toBe("draft");

      const editDraft = await server.inject({
        method: "PATCH",
        url: `/tenant/training-needs/${draftBId}`,
        headers,
        payload: { priority: "medium" },
      });
      expect(editDraft.statusCode).toBe(200);
      expect(editDraft.json().data.status).toBe("draft");

      // tna.manage.all can delete any entry regardless of status or department.
      const deleteSubmitted = await server.inject({
        method: "DELETE",
        url: `/tenant/training-needs/${submittedAId}`,
        headers,
      });
      expect(deleteSubmitted.statusCode).toBe(204);
    } finally {
      await server.close();
    }
  });

  it("a tna.view.department holder sees only their own department's subtree, even via a crafted department filter", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { parentId, childId, unrelatedId, viewerId } = await withTenantDb(tenantId, async (db) => {
      const [parent] = await db.insert(departments).values({ tenantId, name: `Parent ${randomUUID()}` }).returning({ id: departments.id });
      const [child] = await db
        .insert(departments)
        .values({ tenantId, name: `Child ${randomUUID()}`, parentDepartmentId: parent.id })
        .returning({ id: departments.id });
      const [unrelated] = await db.insert(departments).values({ tenantId, name: `Unrelated ${randomUUID()}` }).returning({ id: departments.id });
      const [viewer] = await db
        .insert(users)
        .values({ tenantId, fullName: "Dept Viewer", email: `viewer-${randomUUID()}@example.com`, departmentId: parent.id })
        .returning({ id: users.id });
      return { parentId: parent.id, childId: child.id, unrelatedId: unrelated.id, viewerId: viewer.id };
    });
    await seedUserWithRole(tenantId, viewerId, ["tna.view.department", "tna.manage.department"]);

    const { parentEntryId, childEntryId, unrelatedEntryId } = await withTenantDb(tenantId, async (db) => {
      const [parentEntry] = await db
        .insert(trainingNeeds)
        .values({ tenantId, departmentId: parentId, title: "Parent need", priority: "low", status: "draft" })
        .returning({ id: trainingNeeds.id });
      const [childEntry] = await db
        .insert(trainingNeeds)
        .values({ tenantId, departmentId: childId, title: "Child need", priority: "low", status: "submitted", submittedAt: new Date() })
        .returning({ id: trainingNeeds.id });
      const [unrelatedEntry] = await db
        .insert(trainingNeeds)
        .values({ tenantId, departmentId: unrelatedId, title: "Unrelated need", priority: "low", status: "submitted", submittedAt: new Date() })
        .returning({ id: trainingNeeds.id });
      return { parentEntryId: parentEntry.id, childEntryId: childEntry.id, unrelatedEntryId: unrelatedEntry.id };
    });

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };

      const list = await server.inject({ method: "GET", url: "/tenant/training-needs", headers });
      expect(list.statusCode).toBe(200);
      const ids = list.json().data.map((row: { id: string }) => row.id);
      expect(ids).toEqual(expect.arrayContaining([parentEntryId, childEntryId]));
      expect(ids).not.toContain(unrelatedEntryId);

      // Direct-by-id access to an out-of-subtree entry returns 404, not 403 (research.md §9).
      const detail = await server.inject({
        method: "GET",
        url: `/tenant/training-needs/${unrelatedEntryId}`,
        headers,
      });
      expect(detail.statusCode).toBe(404);

      const editOutOfScope = await server.inject({
        method: "PATCH",
        url: `/tenant/training-needs/${unrelatedEntryId}`,
        headers,
        payload: { priority: "high" },
      });
      expect(editOutOfScope.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
