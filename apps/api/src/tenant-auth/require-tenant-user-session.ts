import type { preHandlerHookHandler } from "fastify";

/**
 * Denies by default: no verified `request.user` (tenant-user-context.ts) means no access.
 *
 * Additionally denies by default when the account still has a one-time password active
 * (`request.mustChangePassword`, spec FR-013a, US5 AS3) — every guarded route except
 * `POST /tenant-auth/set-password` must reject until the real password is set. Pass
 * `{ allowMustChangePassword: true }` for that one, single, explicit exception.
 */
export function requireTenantUserSession(
  options: { allowMustChangePassword?: boolean } = {},
): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, message: "Not authenticated" });
    }
    if (request.mustChangePassword && !options.allowMustChangePassword) {
      return reply.code(403).send({ success: false, message: "Password change required" });
    }
  };
}
