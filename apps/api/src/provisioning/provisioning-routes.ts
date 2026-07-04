import type { FastifyPluginAsync } from "fastify";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import {
  provisionTenant,
  SubdomainTakenError,
  ReservedSubdomainError,
  MissingAdminRoleTemplateError,
  DuplicateDepartmentNameError,
  type ProvisionTenantInput,
} from "./provision-tenant";

function missingField(input: Partial<ProvisionTenantInput>): string | undefined {
  if (!input.company?.name) return "company.name is required";
  if (!input.company?.subdomain) return "company.subdomain is required";
  if (!input.company?.primaryContact?.name) return "company.primaryContact.name is required";
  if (!input.company?.primaryContact?.email) return "company.primaryContact.email is required";
  if (!input.admin?.fullName) return "admin.fullName is required";
  if (!input.admin?.email) return "admin.email is required";
  return undefined;
}

/** contracts/provision-tenant-api.md — platform-connection-context route, not tenant-scoped: no
 * tenant exists yet at the start of the request (research.md §1), so this does not use
 * `request.tenantDb`; `provisionTenant` opens and manages its own transaction against
 * `fastify.pg.pool`. Guarded by `requireSuperAdminSession` (Super Admin Authentication spec),
 * superseding the original `requirePlatformPermission("provision_tenant")`/`tm_platform_reader`
 * mechanism — now a binary Super Admin check, not a permission-key check. */
const provisioningRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: Partial<ProvisionTenantInput> }>(
    "/provisioning/tenants",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const error = missingField(request.body ?? {});
      if (error) {
        return reply.code(400).send({ success: false, message: error });
      }

      try {
        const result = await provisionTenant(fastify.pg.pool, request.body as ProvisionTenantInput);
        return reply.code(201).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof SubdomainTakenError) {
          return reply.code(409).send({ success: false, message: "Subdomain already in use" });
        }
        if (err instanceof ReservedSubdomainError) {
          return reply.code(409).send({ success: false, message: "Subdomain is reserved" });
        }
        if (err instanceof DuplicateDepartmentNameError) {
          return reply.code(409).send({ success: false, message: "Duplicate department name" });
        }
        if (err instanceof MissingAdminRoleTemplateError) {
          request.log.error(err, "Provisioning misconfigured: hr_admin role template missing");
          return reply.code(500).send({
            success: false,
            message: "Provisioning is misconfigured: required admin role template not found",
          });
        }
        throw err;
      }
    },
  );
};

export default provisioningRoutes;
