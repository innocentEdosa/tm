import type { FastifyPluginAsync } from "fastify";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { listTenants } from "./list-tenants";
import { editTenant, type EditTenantInput } from "./edit-tenant";
import { archiveTenant, reactivateTenant } from "./archive-tenant";
import { downgradeTenant, TenantAlreadyAtLowestStatusError } from "./downgrade-tenant";
import { deleteTenant, recoverTenant } from "./delete-tenant";
import {
  TenantNotFoundError,
  TenantLockedError,
  TenantDeleteConfirmationMismatchError,
  TenantNotPendingDeletionError,
} from "./errors";
import { SubdomainTakenError, ReservedSubdomainError } from "../provisioning/provision-tenant";

/**
 * contracts/tenant-management-api.md — platform-connection-context routes (no `tenant_id` in scope,
 * mirrors `provisioning-routes.ts`'s posture), guarded by `requireSuperAdminSession`. Every handler
 * reads/writes through `request.superAdminDb!` — never `fastify.pg.pool` directly, never
 * `request.tenantDb` — to exercise the `super_admin_full_access` RLS policies added in migrations
 * 0054/0055 (research.md §8). Story phases fill each handler in; anything still returning `501` here
 * has not been implemented yet.
 */
const tenantManagementRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/tenants",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
      const pageSize = request.query.pageSize ? parseInt(request.query.pageSize, 10) : undefined;
      const result = await listTenants(request.superAdminDb!, { page, pageSize });
      return { success: true, data: result };
    },
  );

  fastify.patch<{ Params: { id: string }; Body: EditTenantInput }>(
    "/tenants/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await editTenant(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
          input: request.body ?? {},
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        if (err instanceof TenantLockedError) {
          return reply.code(409).send({ success: false, message: err.message });
        }
        if (err instanceof SubdomainTakenError) {
          return reply.code(409).send({ success: false, message: "Subdomain already in use" });
        }
        if (err instanceof ReservedSubdomainError) {
          return reply.code(409).send({ success: false, message: "Subdomain is reserved" });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/tenants/:id/archive",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await archiveTenant(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/tenants/:id/reactivate",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await reactivateTenant(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        if (err instanceof TenantLockedError) {
          return reply.code(409).send({ success: false, message: err.message });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/tenants/:id/downgrade",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await downgradeTenant(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        if (err instanceof TenantLockedError) {
          return reply.code(409).send({ success: false, message: err.message });
        }
        if (err instanceof TenantAlreadyAtLowestStatusError) {
          return reply.code(409).send({ success: false, message: err.message });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: { confirmTenantName?: string } }>(
    "/tenants/:id/delete",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await deleteTenant(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
          confirmTenantName: request.body?.confirmTenantName,
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        if (err instanceof TenantDeleteConfirmationMismatchError) {
          return reply.code(400).send({ success: false, message: err.message });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/tenants/:id/recover",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await recoverTenant(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        if (err instanceof TenantNotPendingDeletionError) {
          return reply.code(409).send({ success: false, message: err.message });
        }
        throw err;
      }
    },
  );
};

export default tenantManagementRoutes;
