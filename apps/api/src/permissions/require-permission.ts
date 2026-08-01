import type { preHandlerHookHandler } from "fastify";
import { sql } from "drizzle-orm";

type TenantDb = { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

/**
 * Shared by `requirePermission`/`requireAnyPermission` and by any route that needs to branch on a
 * permission check itself rather than just gate access (e.g. the course list/detail routes decide
 * whether to apply their learner-visibility filter based on whether the caller holds
 * `course.manage`). Queries through `tenantDb`, so RLS already scopes every row read here to the
 * caller's own tenant (research.md §3) — this never needs its own tenant filter.
 */
export async function userHasAnyPermission(
  tenantDb: TenantDb,
  userId: string,
  permissionKeys: string[],
): Promise<boolean> {
  const rows = await tenantDb.execute(sql`
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ${userId}
      AND p.key IN ${permissionKeys}
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

/**
 * Denies by default (FR-010): a user with zero `user_roles` rows, or whose roles don't grant
 * `permissionKey`, gets 403.
 */
export function requirePermission(permissionKey: string): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user) {
      return reply.code(403).send({ success: false, message: "Forbidden" });
    }
    if (!(await userHasAnyPermission(request.tenantDb, request.user.id, [permissionKey]))) {
      return reply.code(403).send({ success: false, message: "Forbidden" });
    }
  };
}

/**
 * Granular Permissions follow-up (spec 011 addendum): grants access if the caller holds *any* of
 * the given keys — the mechanism behind the additive migration from a module's one coarse "manage"
 * permission to separate create/read/edit/delete keys. A route checks
 * `requireAnyPermission("department.manage", "department.edit")` so a role holding only the
 * legacy superset keeps working exactly as before, while a role holding only the new granular key
 * also passes — neither key is ever removed or renamed to achieve this.
 */
export function requireAnyPermission(...permissionKeys: string[]): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user) {
      return reply.code(403).send({ success: false, message: "Forbidden" });
    }
    if (!(await userHasAnyPermission(request.tenantDb, request.user.id, permissionKeys))) {
      return reply.code(403).send({ success: false, message: "Forbidden" });
    }
  };
}
