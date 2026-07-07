import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { seedDefaultRolesForTenant } from "../../src/permissions/seed-default-roles";
import { roles, rolePermissions } from "../../src/db/schema/roles";
import { permissions } from "../../src/db/schema/permissions";

describe("seedDefaultRolesForTenant", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates exactly hr_admin, manager, employee (never super_admin) with matching permissions", async () => {
    const tenantId = randomUUID();

    const { rolesCreated } = await withTenantDb(tenantId, (db) =>
      seedDefaultRolesForTenant(db, tenantId),
    );

    expect(rolesCreated).toBe(3);

    const createdRoles = await withTenantDb(tenantId, (db) =>
      db.select({ name: roles.name }).from(roles),
    );
    const names = createdRoles.map((r) => r.name).sort();
    expect(names).toEqual(["Employee/Learner", "HR/L&D Admin", "Manager"].sort());
    expect(names).not.toContain("Super Admin");

    const hrAdminPermissions = await withTenantDb(tenantId, async (db) => {
      const [hrAdmin] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, "HR/L&D Admin"));
      return db
        .select({ key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(rolePermissions.roleId, hrAdmin.id));
    });
    expect(hrAdminPermissions.map((p) => p.key).sort()).toEqual(
      [
        "approve_enrollment",
        "edit_content_library",
        "manage_roles",
        "view_department_analytics",
        // Tenant Authentication Configuration spec (0022_seed_tenant_auth_permissions.sql):
        "manage_authentication_settings",
        "manage_team_members",
        // Department Management spec (0025_seed_department_permissions.sql):
        "department.view",
        "department.manage",
        // Extensible Custom Fields Framework spec (0031_seed_forms_permissions.sql):
        "forms.manage.tenant",
        // Granular Permissions addendum (0038_seed_granular_crud_permissions.sql):
        "department.create",
        "department.edit",
        "department.delete",
        "roles.read",
        "roles.create",
        "roles.edit",
        "roles.delete",
        "forms.tenant.read",
        "forms.tenant.create",
        "forms.tenant.edit",
        "team.create",
      ].sort(),
    );
  });

  it("fails on the (tenant_id, name) unique constraint rather than duplicating rows when called twice", async () => {
    const tenantId = randomUUID();

    await withTenantDb(tenantId, (db) => seedDefaultRolesForTenant(db, tenantId));

    let thrown: unknown;
    try {
      await withTenantDb(tenantId, (db) => seedDefaultRolesForTenant(db, tenantId));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const cause = (thrown as { cause?: { message?: string } })?.cause;
    expect(cause?.message ?? String(thrown)).toMatch(/duplicate key value violates unique constraint/i);

    const createdRoles = await withTenantDb(tenantId, (db) => db.select({ name: roles.name }).from(roles));
    expect(createdRoles).toHaveLength(3);
  });
});
