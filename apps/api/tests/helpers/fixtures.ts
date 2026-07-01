import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { withTenantDb } from "./pg";
import { roles, rolePermissions, userRoles } from "../../src/db/schema/roles";
import { permissions } from "../../src/db/schema/permissions";

/** Creates a tenant-scoped role with the given permission keys and assigns it to `userId`. */
export async function seedUserWithRole(
  tenantId: string,
  userId: string,
  permissionKeys: string[],
): Promise<{ roleId: string }> {
  return withTenantDb(tenantId, async (db) => {
    const [role] = await db
      .insert(roles)
      .values({ tenantId, name: `Test Role ${randomUUID()}` })
      .returning({ id: roles.id });

    if (permissionKeys.length > 0) {
      const perms = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.key, permissionKeys));
      await db.insert(rolePermissions).values(
        perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      );
    }

    await db.insert(userRoles).values({ tenantId, userId, roleId: role.id });

    return { roleId: role.id };
  });
}

/** Creates a tenant-scoped role with the given permission keys, not assigned to anyone. */
export async function seedRole(
  tenantId: string,
  name: string,
  permissionKeys: string[] = [],
): Promise<{ roleId: string }> {
  return withTenantDb(tenantId, async (db) => {
    const [role] = await db.insert(roles).values({ tenantId, name }).returning({ id: roles.id });

    if (permissionKeys.length > 0) {
      const perms = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.key, permissionKeys));
      await db.insert(rolePermissions).values(
        perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      );
    }

    return { roleId: role.id };
  });
}

/** Assigns an existing role to a user within a tenant. */
export async function assignRole(tenantId: string, userId: string, roleId: string): Promise<void> {
  await withTenantDb(tenantId, async (db) => {
    await db.insert(userRoles).values({ tenantId, userId, roleId });
  });
}
