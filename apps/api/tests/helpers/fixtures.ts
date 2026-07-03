import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { inArray } from "drizzle-orm";
import { withTenantDb } from "./pg";
import { roles, rolePermissions, userRoles } from "../../src/db/schema/roles";
import { permissions } from "../../src/db/schema/permissions";
import { hashSessionToken, generateSessionToken, sessionExpiryFromNow } from "../../src/platform-auth/session";
import { SUPER_ADMIN_COOKIE_NAME } from "../../src/platform-auth/cookies";

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
 * Creates a real `super_admins` row and a valid, non-expired `super_admin_sessions` row for it
 * directly (bypassing the login endpoint, matching the pattern already used to seed tenant-scoped
 * fixtures), returning a ready-to-use `Cookie` header value for `requireSuperAdminSession`-guarded
 * routes (Super Admin Authentication spec). Opens and closes its own short-lived connection as the
 * migration/owner role — `tm_app` has no `INSERT` grant on `super_admins` by design (research.md
 * §7), so this cannot go through `withTenantDb`/`getTestPool()` like the tenant-scoped helpers
 * above.
 */
export async function seedSuperAdminSession(): Promise<{ cookieHeader: string }> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const email = `test-super-admin-${randomUUID()}@example.com`;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO super_admins (email, password_hash, name) VALUES ($1, 'irrelevant', 'Test Super Admin')
       RETURNING id`,
      [email],
    );
    const superAdminId = inserted.rows[0].id;

    const token = generateSessionToken();
    await pool.query(
      `INSERT INTO super_admin_sessions (super_admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [superAdminId, hashSessionToken(token), sessionExpiryFromNow()],
    );

    return { cookieHeader: `${SUPER_ADMIN_COOKIE_NAME}=${token}` };
  } finally {
    await pool.end();
  }
}
