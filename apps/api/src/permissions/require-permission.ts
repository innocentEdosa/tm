import type { preHandlerHookHandler } from "fastify";
import { sql } from "drizzle-orm";

/**
 * Denies by default (FR-010): a user with zero `user_roles` rows, or whose roles don't grant
 * `permissionKey`, gets 403. Queries through `request.tenantDb`, so RLS already scopes every row
 * read here to the caller's own tenant (research.md §3) — this never needs its own tenant filter.
 */
export function requirePermission(permissionKey: string): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user) {
      return reply.code(403).send({ success: false, message: "Forbidden" });
    }

    const rows = await request.tenantDb.execute(sql`
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ${request.user.id}
        AND p.key = ${permissionKey}
      LIMIT 1
    `);

    if (rows.rows.length === 0) {
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

    const rows = await request.tenantDb.execute(sql`
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ${request.user.id}
        AND p.key IN ${permissionKeys}
      LIMIT 1
    `);

    if (rows.rows.length === 0) {
      return reply.code(403).send({ success: false, message: "Forbidden" });
    }
  };
}
