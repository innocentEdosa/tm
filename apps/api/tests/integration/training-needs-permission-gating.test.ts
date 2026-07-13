import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("training needs: Manager create/draft/submit/edit/delete lifecycle (spec 014 US1)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns 403 for a user with no tna.* permission", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, []);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const list = await server.inject({ method: "GET", url: "/tenant/training-needs", headers });
      expect(list.statusCode).toBe(403);

      const create = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Data Protection Training", priority: "medium" },
      });
      expect(create.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("a tna.manage.department Manager creates, saves as draft, submits, edits after submission, then deletes only a draft", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { departmentId, managerId } = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Security ${randomUUID()}` })
        .returning({ id: departments.id });
      const [manager] = await db
        .insert(users)
        .values({
          tenantId,
          fullName: "Dept Manager",
          email: `manager-${randomUUID()}@example.com`,
          departmentId: dept.id,
        })
        .returning({ id: users.id });
      return { departmentId: dept.id, managerId: manager.id };
    });
    await seedUserWithRole(tenantId, managerId, ["tna.view.department", "tna.manage.department"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };

      // A mismatched departmentId is rejected outright for a manage.department-only caller, not
      // silently overridden (spec FR-002) — the caller must never assume a submission landed
      // somewhere it didn't ask for.
      const crafted = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Data Protection Training", priority: "medium", departmentId: randomUUID() },
      });
      expect(crafted.statusCode).toBe(403);

      // Create as Draft (status omitted) — auto-scoped to the caller's own department, not
      // client-editable (spec FR-002).
      const create = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Data Protection Training", priority: "medium" },
      });
      expect(create.statusCode).toBe(201);
      const created = create.json().data;
      expect(created.status).toBe("draft");
      expect(created.departmentId).toBe(departmentId);

      // Draft is resumable/editable.
      const patchDraft = await server.inject({
        method: "PATCH",
        url: `/tenant/training-needs/${created.id}`,
        headers,
        payload: { title: "Data Protection Training (updated)" },
      });
      expect(patchDraft.statusCode).toBe(200);
      expect(patchDraft.json().data.status).toBe("draft");

      // Submit.
      const submit = await server.inject({
        method: "PATCH",
        url: `/tenant/training-needs/${created.id}`,
        headers,
        payload: { status: "submitted" },
      });
      expect(submit.statusCode).toBe(200);
      expect(submit.json().data.status).toBe("submitted");
      expect(submit.json().data.submittedAt).not.toBeNull();

      // Editing after submission does not require re-approval or reset status (spec FR-006).
      const editAfterSubmit = await server.inject({
        method: "PATCH",
        url: `/tenant/training-needs/${created.id}`,
        headers,
        payload: { priority: "high" },
      });
      expect(editAfterSubmit.statusCode).toBe(200);
      expect(editAfterSubmit.json().data.status).toBe("submitted");
      expect(editAfterSubmit.json().data.priority).toBe("high");

      // A Manager cannot delete a Submitted entry (Clarification Q1) — only tna.manage.all can.
      const deleteSubmitted = await server.inject({
        method: "DELETE",
        url: `/tenant/training-needs/${created.id}`,
        headers,
      });
      expect(deleteSubmitted.statusCode).toBe(403);

      // A second, still-Draft entry CAN be deleted by its own Manager.
      const createDraft2 = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "IT Security Training", priority: "low" },
      });
      const draft2Id = createDraft2.json().data.id;
      const deleteDraft = await server.inject({
        method: "DELETE",
        url: `/tenant/training-needs/${draft2Id}`,
        headers,
      });
      expect(deleteDraft.statusCode).toBe(204);

      const getDeleted = await server.inject({
        method: "GET",
        url: `/tenant/training-needs/${draft2Id}`,
        headers,
      });
      expect(getDeleted.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid priority value and a missing title", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { managerId } = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId, name: `Ops ${randomUUID()}` }).returning({ id: departments.id });
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager", email: `mgr-${randomUUID()}@example.com`, departmentId: dept.id })
        .returning({ id: users.id });
      return { managerId: manager.id };
    });
    await seedUserWithRole(tenantId, managerId, ["tna.view.department", "tna.manage.department"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };

      const missingTitle = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { priority: "low" },
      });
      expect(missingTitle.statusCode).toBe(400);

      const badPriority = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Refresher Training", priority: "urgent" },
      });
      expect(badPriority.statusCode).toBe(400);

      // Draft creation succeeds with no custom field values at all (spec FR-004) once title/priority
      // are valid — required-custom-field enforcement at Submit time is covered by
      // custom-fields-tna-integration.test.ts (spec US3).
      const draft = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Refresher Training", priority: "low" },
      });
      expect(draft.statusCode).toBe(201);
      expect(draft.json().data.status).toBe("draft");
    } finally {
      await server.close();
    }
  });
});
