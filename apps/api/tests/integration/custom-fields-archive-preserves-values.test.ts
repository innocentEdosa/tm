import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { customFieldValues } from "../../src/db/schema/custom-fields";

describe("custom fields: archiving preserves historical values (spec FR-009/SC-005, User Story 4)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("archiving a field with a stored value hides it from future renders but leaves the value intact", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUserWithRole(tenantId, adminId, ["department.manage", "forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };

      const createField = await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers,
        payload: { formKey: "department", label: "Cost Center", fieldType: "text" },
      });
      expect(createField.statusCode).toBe(201);
      const fieldId = createField.json().data.id;

      const createDept = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers,
        payload: { name: `Dept ${randomUUID()}`, customFieldValues: { cost_center: "Engineering" } },
      });
      expect(createDept.statusCode).toBe(201);
      const departmentId = createDept.json().data.id;

      const archive = await server.inject({
        method: "PATCH",
        url: `/tenant/form-fields/${fieldId}`,
        headers,
        payload: { archived: true },
      });
      expect(archive.statusCode).toBe(200);

      const fieldsAfterArchive = await server.inject({
        method: "GET",
        url: "/tenant/form-fields?formKey=department",
        headers,
      });
      const keys = fieldsAfterArchive.json().data.map((f: { fieldKey: string }) => f.fieldKey);
      expect(keys).not.toContain("cost_center");

      const storedValue = await withTenantDb(tenantId, async (db) =>
        db.select({ value: customFieldValues.value }).from(customFieldValues).where(eq(customFieldValues.fieldId, fieldId)),
      );
      expect(storedValue).toHaveLength(1);
      expect(storedValue[0].value).toBe("Engineering");

      const valuesAfterArchive = await server.inject({
        method: "GET",
        url: `/tenant/custom-field-values?formKey=department&entityId=${departmentId}`,
        headers,
      });
      expect(valuesAfterArchive.json().data.cost_center).toBe("Engineering");
    } finally {
      await server.close();
    }
  });
});
