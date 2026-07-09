import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { formDefinitions, formFields } from "../../src/db/schema/custom-fields";

describe("POST/PATCH /tenant/team — custom field validation (spec 013 US3, FR-008/FR-009)", () => {
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
          fieldKey: `personnel_number_${randomUUID().replace(/-/g, "")}`,
          label: "Personnel Number",
          fieldType: "text",
          isRequired: true,
          displayOrder: 1,
          createdBy: "tenant_admin",
        })
        .returning({ id: formFields.id, fieldKey: formFields.fieldKey });
      return field;
    });
  }

  it("POST rejects a missing required custom field with a field-level 422, before any write", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: adminId, tenantId, fullName: "Admin", email: `admin-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, adminId, ["manage_team_members"]);
    const { roleId } = await seedRole(tenantId, "Employee", []);
    const field = await seedRequiredMemberField(tenantId);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Member", email: `new-${randomUUID()}@example.com`, roleId, customFieldValues: {} },
      });
      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ fieldKey: field.fieldKey })]),
      );
    } finally {
      await server.close();
    }
  });

  it("valid custom field values are written on create and retrievable, and updatable via PATCH", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: adminId, tenantId, fullName: "Admin", email: `admin-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, adminId, ["manage_team_members", "team.edit"]);
    const { roleId } = await seedRole(tenantId, "Employee", []);
    const field = await seedRequiredMemberField(tenantId);

    const server = await buildTestServer();
    try {
      const email = `new-${randomUUID()}@example.com`;
      const createResponse = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: {
          fullName: "New Member",
          email,
          roleId,
          customFieldValues: { [field.fieldKey]: "AB-12345" },
        },
      });
      expect(createResponse.statusCode).toBe(201);
      const memberId = createResponse.json().data.id;

      const valuesResponse = await server.inject({
        method: "GET",
        url: `/tenant/custom-field-values?formKey=member&entityId=${memberId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(valuesResponse.json().data[field.fieldKey]).toBe("AB-12345");

      const editResponse = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
        payload: { customFieldValues: { [field.fieldKey]: "CD-67890" } },
      });
      expect(editResponse.statusCode).toBe(200);

      const updatedValues = await server.inject({
        method: "GET",
        url: `/tenant/custom-field-values?formKey=member&entityId=${memberId}`,
        headers: { "x-test-user-id": adminId, "x-test-tenant-id": tenantId },
      });
      expect(updatedValues.json().data[field.fieldKey]).toBe("CD-67890");
    } finally {
      await server.close();
    }
  });
});
