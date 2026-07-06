import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { formFields, formDefinitions } from "../../src/db/schema/custom-fields";

describe("custom fields: Department retrofit end-to-end (spec FR-007/FR-015)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a department with custom field values, using only department.manage (not forms.manage.tenant, spec FR-010)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    // Deliberately only department.manage — proves FR-010's "no separate permission needed" claim,
    // not just something that happens to pass because the test user also holds forms.manage.tenant.
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };

      // The acting user has no forms.manage.tenant, so it adds its own field via direct DB access
      // to set up the scenario — a real forms.manage.tenant-holding admin would use Settings > Forms.
      await withTenantDb(tenantId, async (db) => {
        const [definition] = await db.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, "department"));
        await db.insert(formFields).values({
          formDefinitionId: definition.id,
          tenantId,
          fieldKey: "headcount_target",
          label: "Headcount Target",
          fieldType: "number",
          isRequired: true,
          displayOrder: 0,
          createdBy: "tenant_admin",
        });
      });

      const missingRequired = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers,
        payload: { name: `Dept ${randomUUID()}`, customFieldValues: {} },
      });
      expect(missingRequired.statusCode).toBe(422);

      const create = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers,
        payload: { name: `Dept ${randomUUID()}`, customFieldValues: { headcount_target: 12 } },
      });
      expect(create.statusCode).toBe(201);
      const departmentId = create.json().data.id;

      const wrongType = await server.inject({
        method: "PATCH",
        url: `/tenant/departments/${departmentId}`,
        headers,
        payload: { customFieldValues: { headcount_target: "not a number" } },
      });
      expect(wrongType.statusCode).toBe(422);

      const values = await server.inject({
        method: "GET",
        url: `/tenant/custom-field-values?formKey=department&entityId=${departmentId}`,
        headers,
      });
      expect(values.statusCode).toBe(200);
      expect(values.json().data.headcount_target).toBe(12);
    } finally {
      await server.close();
    }
  });

  it("does not commit the department when custom field validation fails (atomicity)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage"]);

    await withTenantDb(tenantId, async (db) => {
      const [definition] = await db.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, "department"));
      await db.insert(formFields).values({
        formDefinitionId: definition.id,
        tenantId,
        fieldKey: "required_field",
        label: "Required Field",
        fieldType: "text",
        isRequired: true,
        displayOrder: 0,
        createdBy: "tenant_admin",
      });
    });

    const deptName = `Dept ${randomUUID()}`;
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { name: deptName, customFieldValues: {} },
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await server.close();
    }

    const found = await withTenantDb(tenantId, async (db) =>
      db.select({ id: departments.id }).from(departments).where(eq(departments.name, deptName)),
    );
    expect(found).toHaveLength(0);
  });
});
