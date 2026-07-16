import type { FastifyPluginAsync } from "fastify";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { getTenantDetail } from "./get-tenant-detail";
import { getTenantDepartments } from "./get-tenant-departments";
import { getTenantRoles } from "./get-tenant-roles";
import { getTenantMembers } from "./get-tenant-members";
import { resetMemberPassword } from "./reset-member-password";
import { TenantNotFoundError, MemberNotFoundError } from "./errors";

/**
 * contracts/super-admin-tenant-console-api.md — platform-connection-context routes (no `tenant_id`
 * in scope beyond the route's own `:id` param), guarded by `requireSuperAdminSession`. Every handler
 * reads/writes through `request.superAdminDb!` — never `fastify.pg.pool` directly, never
 * `request.tenantDb` — to exercise the `super_admin_full_access` RLS policies added in migrations
 * 0059-0063 (research.md §3). Every query is explicitly filtered by the route's own `:id`/`:memberId`
 * param — never inferred from this connection's ambient (tenant-agnostic) RLS context (research.md
 * §1, plan.md Summary).
 */
const superAdminTenantConsoleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    "/tenants/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await getTenantDetail(request.superAdminDb!, { tenantId: request.params.id });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        throw err;
      }
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/tenants/:id/departments",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await getTenantDepartments(request.superAdminDb!, { tenantId: request.params.id });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        throw err;
      }
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/tenants/:id/roles",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await getTenantRoles(request.superAdminDb!, { tenantId: request.params.id });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        throw err;
      }
    },
  );

  fastify.get<{
    Params: { id: string };
    Querystring: { search?: string; page?: string; pageSize?: string };
  }>(
    "/tenants/:id/members",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
        const pageSize = request.query.pageSize ? parseInt(request.query.pageSize, 10) : undefined;
        const result = await getTenantMembers(request.superAdminDb!, {
          tenantId: request.params.id,
          search: request.query.search,
          page,
          pageSize,
        });
        return { success: true, data: result.data, meta: result.meta };
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string; memberId: string } }>(
    "/tenants/:id/members/:memberId/reset-password",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await resetMemberPassword(request.superAdminDb!, {
          tenantId: request.params.id,
          memberId: request.params.memberId,
          superAdminId: request.superAdmin!.id,
        });
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof MemberNotFoundError) {
          return reply.code(404).send({ success: false, message: "Member not found" });
        }
        throw err;
      }
    },
  );
};

export default superAdminTenantConsoleRoutes;
