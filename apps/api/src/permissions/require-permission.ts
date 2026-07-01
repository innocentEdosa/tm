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
