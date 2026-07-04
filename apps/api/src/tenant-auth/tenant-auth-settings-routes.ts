import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { requireTenantUserSession } from "./require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { tenantAuthMethods } from "../db/schema/tenant-auth-methods";

const VALID_METHODS = ["email_password", "microsoft", "google_workspace", "zoho"];

/** contracts/tenant-auth-api.md. Operates through `request.tenantDb` (RLS-scoped by the verified
 * session's tenant_id, via tenant-context.ts) — never a client-supplied tenant identifier. */
const tenantAuthSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/tenant-auth/settings/methods",
    { preHandler: [requireTenantUserSession(), requirePermission("manage_authentication_settings")] },
    async (request) => {
      const rows = await request.tenantDb
        .select({ method: tenantAuthMethods.method })
        .from(tenantAuthMethods)
        .where(eq(tenantAuthMethods.tenantId, request.user!.tenantId));
      return { success: true, data: { methods: rows.map((r) => r.method) } };
    },
  );

  fastify.put<{ Body: { methods?: string[] } }>(
    "/tenant-auth/settings/methods",
    { preHandler: [requireTenantUserSession(), requirePermission("manage_authentication_settings")] },
    async (request, reply) => {
      const methods = request.body?.methods;
      if (!Array.isArray(methods) || methods.length === 0) {
        // FR-006: at least one method must remain enabled.
        return reply.code(409).send({ success: false, message: "At least one login method must be enabled" });
      }
      const invalid = methods.find((m) => !VALID_METHODS.includes(m));
      if (invalid) {
        return reply.code(400).send({ success: false, message: `Unknown method: ${invalid}` });
      }

      const tenantId = request.user!.tenantId;
      await request.tenantDb.delete(tenantAuthMethods).where(eq(tenantAuthMethods.tenantId, tenantId));
      await request.tenantDb
        .insert(tenantAuthMethods)
        .values(methods.map((method) => ({ tenantId, method })));

      return reply.code(200).send({ success: true, data: { methods } });
    },
  );
};

export default tenantAuthSettingsRoutes;
