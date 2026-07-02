import { randomUUID } from "node:crypto";
import { inArray, isNull } from "drizzle-orm";
import { withTenantDb } from "./pg";
import { roles, rolePermissions, userRoles } from "../../src/db/schema/roles";
import { permissions } from "../../src/db/schema/permissions";
import { getPlatformReaderDb } from "../../src/db/platform-reader";

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

/**
 * Assigns `userId` the platform Super Admin role (`roles.tenant_id IS NULL`), for tests exercising
 * `requirePlatformPermission`-guarded routes. Looks up the role id via the BYPASSRLS platform-reader
 * connection (the same one `isSuperAdminWithPermission` uses) — a normal tenant-scoped connection can
 * never see that row by design (FR-007). The `user_roles` row itself still needs some `tenant_id`
 * (NOT NULL column, functionally unused by the platform-reader lookup, which joins only on
 * `role_id`/`user_id`), so a throwaway sentinel tenant id is used for that one column.
 */
export async function seedSuperAdminUser(userId: string): Promise<void> {
  const [superAdminRole] = await getPlatformReaderDb()
    .select({ id: roles.id })
    .from(roles)
    .where(isNull(roles.tenantId));
  if (!superAdminRole) {
    throw new Error("Platform Super Admin role not seeded — run migrations through 0007+");
  }

  const sentinelTenantId = randomUUID();
  await withTenantDb(sentinelTenantId, async (db) => {
    await db.insert(userRoles).values({ tenantId: sentinelTenantId, userId, roleId: superAdminRole.id });
  });
}
