import type { preHandlerHookHandler } from "fastify";
import { sql } from "drizzle-orm";
import { getPlatformReaderDb } from "../db/platform-reader";

/**
 * Verifies, via `tm_platform_reader` (BYPASSRLS), that `userId` holds the platform Super Admin
 * role (`roles.tenant_id IS NULL` — the only such row) AND that role grants `permissionKey`. A
 * single query proves both facts, since the platform role is the only `tenant_id IS NULL` row.
 */
async function isSuperAdminWithPermission(userId: string, permissionKey: string): Promise<boolean> {
  const result = await getPlatformReaderDb().execute(sql`
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.tenant_id IS NULL
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ${userId}
      AND p.key = ${permissionKey}
    LIMIT 1
  `);
  return result.rows.length > 0;
}

/**
 * Guards the Super Admin catalog routes (contracts/super-admin-catalog-api.md). These routes run
 * outside the per-request tenant transaction (research.md §3) — this is intentionally NOT
 * `requirePermission`, which depends on `request.tenantDb`.
 */
export function requirePlatformPermission(permissionKey: string): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user || !(await isSuperAdminWithPermission(request.user.id, permissionKey))) {
      return reply.code(403).send({ success: false, message: "Forbidden" });
    }
  };
}
