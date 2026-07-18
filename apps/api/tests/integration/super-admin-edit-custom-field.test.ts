import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { formDefinitions, formFields, customFieldValues } from "../../src/db/schema/custom-fields";

describe("PATCH /tenants/:id/custom-fields/:fieldId (spec FR-008)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedTenantField(tenantId: string) {
    return withTenantDb(tenantId, async (db) => {
      const [definition] = await db
        .select({ id: formDefinitions.id })
        .from(formDefinitions)
        .where(eq(formDefinitions.key, "member"));
      const [field] = await db
        .insert(formFields)
        .values({
          tenantId,
          formDefinitionId: definition.id,
          fieldKey: `edit_target_${randomUUID().replace(/-/g, "")}`,
          label: "Original Label",
          fieldType: "text",
          displayOrder: 5,
          createdBy: "super_admin",
        })
        .returning({ id: formFields.id, formDefinitionId: formFields.formDefinitionId });
      return field;
    });
  }

  it("edits label/fieldType/isRequired", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const field = await seedTenantField(tenantId);
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/custom-fields/${field.id}`,
        headers: { cookie: cookieHeader },
        payload: { label: "New Label", isRequired: true },
      });
      expect(response.statusCode).toBe(200);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(formFields).where(eq(formFields.id, field.id)),
      );
      expect(row.label).toBe("New Label");
      expect(row.isRequired).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("archives a field without deleting a previously stored value", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const field = await seedTenantField(tenantId);
    const entityId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(customFieldValues).values({
        tenantId,
        formDefinitionId: field.formDefinitionId,
        entityId,
        fieldId: field.id,
        value: "kept-value",
      });
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/custom-fields/${field.id}`,
        headers: { cookie: cookieHeader },
        payload: { archived: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.archived).toBe(true);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db.select().from(formFields).where(eq(formFields.id, field.id)),
      );
      expect(row.archivedAt).not.toBeNull();

      const [valueRow] = await withTenantDb(tenantId, async (db) =>
        db.select().from(customFieldValues).where(eq(customFieldValues.fieldId, field.id)),
      );
      expect(valueRow.value).toBe("kept-value");
    } finally {
      await server.close();
    }
  });
});
