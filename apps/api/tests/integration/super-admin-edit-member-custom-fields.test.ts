import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession, seedRole } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { formDefinitions, formFields, customFieldValues } from "../../src/db/schema/custom-fields";

describe("PATCH /tenants/:id/members/:memberId — custom field values (spec FR-003, Assumptions)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedRequiredMemberField(tenantId: string) {
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
          fieldKey: `emp_id_${randomUUID().replace(/-/g, "")}`,
          label: "Employee ID",
          fieldType: "text",
          isRequired: true,
          displayOrder: 1,
          createdBy: "tenant_admin",
        })
        .returning({ id: formFields.id, fieldKey: formFields.fieldKey });
      return field;
    });
  }

  it("validates and persists a custom field value", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const field = await seedRequiredMemberField(tenantId);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "CF Person", email: `cf-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { customFieldValues: { [field.fieldKey]: "EMP-99" } },
      });
      expect(response.statusCode).toBe(200);

      const [row] = await withTenantDb(tenantId, async (db) =>
        db
          .select({ value: customFieldValues.value })
          .from(customFieldValues)
          .where(eq(customFieldValues.entityId, memberId)),
      );
      expect(row.value).toBe("EMP-99");
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid custom field value with 422 and writes nothing", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, `Role ${randomUUID()}`);
    const field = await seedRequiredMemberField(tenantId);
    const memberId = await withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "CF Invalid", email: `cfbad-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenants/${tenantId}/members/${memberId}`,
        headers: { cookie: cookieHeader },
        payload: { customFieldValues: { [field.fieldKey]: "" } },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ fieldKey: field.fieldKey })]),
      );

      const rows = await withTenantDb(tenantId, async (db) =>
        db.select().from(customFieldValues).where(eq(customFieldValues.entityId, memberId)),
      );
      expect(rows).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
