import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedGlobalField } from "../helpers/fixtures";
import { closeTestPool, withSuperAdminTransaction } from "../helpers/pg";

describe("custom fields: global fields stay locked to tenant admins (spec FR-004/SC-002, User Story 3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects a forms.manage.tenant user's PATCH attempt against a global field (404, RLS-unreachable for write)", async () => {
    const global = await seedGlobalField("department");

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/form-fields/${global.id}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { label: "Hijacked" },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
      await global.cleanup();
    }
  });

  it("a global field is visible (read-only) to a tenant session via GET /tenant/form-fields", async () => {
    const global = await seedGlobalField("department");

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, []);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/form-fields?formKey=department",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const found = body.data.find((f: { id: string }) => f.id === global.id);
      expect(found).toBeDefined();
      expect(found.scope).toBe("global");
    } finally {
      await server.close();
      await global.cleanup();
    }
  });

  it("a Super Admin session CAN insert a global (tenant_id NULL) form_fields row — FR-002's data-model support", async () => {
    const fieldKey = `super_admin_write_${randomUUID().slice(0, 8)}`;
    const { rows } = await withSuperAdminTransaction(async (client) =>
      client.query<{ id: string; tenant_id: string | null }>(
        `INSERT INTO form_fields (form_definition_id, tenant_id, field_key, label, field_type, display_order, created_by)
         SELECT id, NULL, $1, 'Super Admin Field', 'text', 0, 'super_admin'
         FROM form_definitions WHERE key = 'department'
         RETURNING id, tenant_id`,
        [fieldKey],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBeNull();

    await withSuperAdminTransaction(async (client) => {
      await client.query(`DELETE FROM form_fields WHERE id = $1`, [rows[0].id]);
    });
  });
});
