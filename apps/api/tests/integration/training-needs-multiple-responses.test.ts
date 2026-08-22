import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withSuperAdminTransaction, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

const FORM_KEY = "training_needs_analysis";

/** Flips `form_definitions.allow_multiple_responses` for Training Request directly — there's no
 * Super-Admin-facing HTTP route for this column yet in these fixtures (mirrors
 * `custom-fields-global-field-locked.test.ts`'s own precedent for driving `super_admin_full_access`
 * straight through SQL when no test-friendly route exists). */
async function setAllowMultipleResponses(value: boolean): Promise<void> {
  await withSuperAdminTransaction(async (client) => {
    await client.query(`UPDATE form_definitions SET allow_multiple_responses = $1 WHERE key = $2`, [value, FORM_KEY]);
  });
}

describe("training needs: multiple form responses feature (form_definitions.allow_multiple_responses)", () => {
  afterEach(async () => {
    // Every test starts from Training Request's real backfilled default (migration 0154) —
    // restore it even if a test fails partway through, so later test files never inherit a
    // flipped flag.
    await setAllowMultipleResponses(true);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  async function seedManager(tenantId: string) {
    const { departmentId, managerId } = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Security ${randomUUID()}` })
        .returning({ id: departments.id });
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Dept Manager", email: `manager-${randomUUID()}@example.com`, departmentId: dept.id })
        .returning({ id: users.id });
      return { departmentId: dept.id, managerId: manager.id };
    });
    await seedUserWithRole(tenantId, managerId, ["training_request.view.department", "training_request.manage.department"]);
    return { departmentId, managerId };
  }

  it("defaults to today's unrestricted behavior — the same caller can create more than one training request", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { managerId } = await seedManager(tenantId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };

      const first = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "First request", priority: "medium" },
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Second request", priority: "low" },
      });
      expect(second.statusCode).toBe(201);
      expect(second.json().data.id).not.toBe(first.json().data.id);
    } finally {
      await server.close();
    }
  });

  it("rejects a second response with 409 once allow_multiple_responses is turned off for the form type", async () => {
    await setAllowMultipleResponses(false);

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { managerId } = await seedManager(tenantId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };

      const first = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Only request", priority: "medium" },
      });
      expect(first.statusCode).toBe(201);
      const firstId = first.json().data.id;

      const second = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Not allowed", priority: "high" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().existingResponseId).toBe(firstId);

      // The existing response is still fully editable — single-response mode blocks creating a
      // second row, never touches the caller's ability to keep working on their one response.
      const patch = await server.inject({
        method: "PATCH",
        url: `/tenant/training-needs/${firstId}`,
        headers,
        payload: { title: "Only request, edited" },
      });
      expect(patch.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("single-response mode is scoped per respondent, not per tenant — a second manager can still create their own first response", async () => {
    await setAllowMultipleResponses(false);

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerA = await seedManager(tenantId);
    const managerB = await seedManager(tenantId);

    const server = await buildTestServer();
    try {
      const first = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers: { "x-test-user-id": managerA.managerId, "x-test-tenant-id": tenantId },
        payload: { title: "Manager A's request", priority: "medium" },
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers: { "x-test-user-id": managerB.managerId, "x-test-tenant-id": tenantId },
        payload: { title: "Manager B's request", priority: "medium" },
      });
      expect(second.statusCode).toBe(201);
    } finally {
      await server.close();
    }
  });
});
