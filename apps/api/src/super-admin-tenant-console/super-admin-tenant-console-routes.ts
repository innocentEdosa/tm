import type { FastifyPluginAsync } from "fastify";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { getTenantDetail } from "./get-tenant-detail";
import { getTenantDepartments } from "./get-tenant-departments";
import { getTenantRoles } from "./get-tenant-roles";
import { getTenantMembers } from "./get-tenant-members";
import { resetMemberPassword } from "./reset-member-password";
import { addTenantMember, type AddTenantMemberInput } from "./add-tenant-member";
import {
  TenantNotFoundError,
  MemberNotFoundError,
  RoleNotFoundError,
  DepartmentNotActiveError,
  EmailConflictError,
} from "./errors";

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

  fastify.post<{ Params: { id: string }; Body: AddTenantMemberInput }>(
    "/tenants/:id/members",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const body = request.body ?? ({} as AddTenantMemberInput);
      if (!body.fullName || !body.email || !body.roleId) {
        return reply
          .code(400)
          .send({ success: false, message: "fullName, email, and roleId are required" });
      }
      try {
        const result = await addTenantMember(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
          input: body,
        });
        return reply.code(201).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          return reply.code(404).send({ success: false, message: "Tenant not found" });
        }
        if (err instanceof RoleNotFoundError) {
          return reply.code(422).send({ success: false, message: "Role not found" });
        }
        if (err instanceof DepartmentNotActiveError) {
          return reply.code(422).send({ success: false, message: "Department not found or not active" });
        }
        if (err instanceof EmailConflictError) {
          return reply.code(409).send({ success: false, message: "Email already in use at this tenant" });
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
