import type { preHandlerHookHandler } from "fastify";

/**
 * Denies by default: a request with no valid Super Admin session (no cookie, or a cookie that
 * doesn't match a live `super_admin_sessions` row — see super-admin-context.ts) gets 401.
 *
 * Also rejects if `request.user` (a tenant-scoped session) is present, even alongside a valid
 * Super Admin cookie — the two session types cannot co-occur by construction (different cookie vs.
 * header mechanisms, research.md §4), but this is a defensive, explicit guarantee rather than
 * relying solely on that structural argument (spec User Story 2; FR-007).
 */
export const requireSuperAdminSession: preHandlerHookHandler = async (request, reply) => {
  if (!request.superAdmin || request.user) {
    return reply.code(401).send({ success: false, message: "Unauthorized" });
  }
};
