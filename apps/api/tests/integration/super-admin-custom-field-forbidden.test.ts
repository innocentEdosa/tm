import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { formDefinitions, formFields } from "../../src/db/schema/custom-fields";

describe("/tenants/:id/custom-fields(/:fieldId) — forbidden without a Super Admin session (spec FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("401s POST/PATCH without a session", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const fieldId = await withTenantDb(tenantId, async (db) => {
      const [definition] = await db
        .select({ id: formDefinitions.id })
        .from(formDefinitions)
        .where(eq(formDefinitions.key, "member"));
      const [field] = await db
        .insert(formFields)
        .values({
          tenantId,
          formDefinitionId: definition.id,
          fieldKey: `forbidden_${randomUUID().replace(/-/g, "")}`,
          label: "X",
          fieldType: "text",
          displayOrder: 0,
          createdBy: "super_admin",
        })
        .returning({ id: formFields.id });
      return field.id;
    });

    const server = await buildTestServer();
    try {
      const post = await server.inject({
        method: "POST",
        url: `/tenants/${tenantId}/custom-fields`,
        payload: { formKey: "member", label: "X", fieldType: "text" },
      });
      expect(post.statusCode).toBe(401);

      const patch = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/custom-fields/${fieldId}`,
        payload: { label: "X" },
      });
      expect(patch.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
