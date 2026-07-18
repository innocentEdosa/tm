import type { FastifyPluginAsync } from "fastify";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { getTenantDetail } from "./get-tenant-detail";
import { getTenantDepartments } from "./get-tenant-departments";
import { getTenantRoles, getPermissionCatalog } from "./get-tenant-roles";
import { getTenantMembers } from "./get-tenant-members";
import { resetMemberPassword } from "./reset-member-password";
import { addTenantMember, type AddTenantMemberInput } from "./add-tenant-member";
import { editTenantMember, type EditTenantMemberInput } from "./edit-tenant-member";
import {
  createTenantRole,
  editTenantRole,
  deleteTenantRole,
  type CreateTenantRoleInput,
  type EditTenantRoleInput,
} from "./manage-tenant-roles";
import {
  createTenantDepartment,
  editTenantDepartment,
  type DepartmentWriteInput,
} from "./manage-tenant-departments";
import {
  createTenantCustomField,
  editTenantCustomField,
  isValidFieldType,
  type CreateTenantCustomFieldInput,
  type EditTenantCustomFieldInput,
} from "./manage-tenant-custom-fields";
import {
  getFormDefinitions,
  getTenantCustomFields,
  getMemberCustomFieldValues,
} from "./get-tenant-custom-fields";
import {
  TenantNotFoundError,
  MemberNotFoundError,
  RoleNotFoundError,
  DepartmentNotActiveError,
  EmailConflictError,
  RecordNotFoundError,
  SystemRoleError,
  RoleInUseError,
  RoleNameConflictError,
  DepartmentValidationError,
  DepartmentNameConflictError,
  FieldKeyConflictError,
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

  fastify.get<{ Params: { id: string; memberId: string } }>(
    "/tenants/:id/members/:memberId/custom-field-values",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const result = await getMemberCustomFieldValues(request.superAdminDb!, {
        entityId: request.params.memberId,
      });
      return { success: true, data: result };
    },
  );

  fastify.patch<{ Params: { id: string; memberId: string }; Body: EditTenantMemberInput }>(
    "/tenants/:id/members/:memberId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const body = request.body ?? ({} as EditTenantMemberInput);
      try {
        const result = await editTenantMember(request.superAdminDb!, {
          tenantId: request.params.id,
          memberId: request.params.memberId,
          superAdminId: request.superAdmin!.id,
          input: body,
        });
        if (!result.ok) {
          switch (result.kind) {
            case "role_not_found":
              return reply.code(422).send({ success: false, message: "Role not found" });
            case "department_not_active":
              return reply
                .code(422)
                .send({ success: false, message: "Department not found or not active" });
            case "leader_archive_blocked":
              return reply.code(422).send({
                success: false,
                message:
                  "This member is a department Manager or Assistant Manager. Reassign that role before archiving them.",
              });
            case "validation":
              return reply.code(422).send({ success: false, errors: result.errors });
          }
        }
        return reply.code(200).send({ success: true, data: result.data });
      } catch (err) {
        if (err instanceof RecordNotFoundError) {
          return reply.code(404).send({ success: false, message: "Member not found" });
        }
        throw err;
      }
    },
  );

  fastify.get(
    "/tenants/:id/permission-catalog",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const result = await getPermissionCatalog(request.superAdminDb!);
      return { success: true, data: result };
    },
  );

  fastify.post<{ Params: { id: string }; Body: CreateTenantRoleInput }>(
    "/tenants/:id/roles",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const body = request.body ?? ({} as CreateTenantRoleInput);
      if (!body.name || !body.name.trim()) {
        return reply.code(400).send({ success: false, message: "name is required" });
      }
      try {
        const result = await createTenantRole(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
          input: body,
        });
        return reply.code(201).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof RoleNameConflictError) {
          return reply.code(409).send({ success: false, message: "Role name already exists" });
        }
        throw err;
      }
    },
  );

  fastify.patch<{ Params: { id: string; roleId: string }; Body: EditTenantRoleInput }>(
    "/tenants/:id/roles/:roleId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await editTenantRole(request.superAdminDb!, {
          tenantId: request.params.id,
          roleId: request.params.roleId,
          superAdminId: request.superAdmin!.id,
          input: request.body ?? {},
        });
        return reply.code(200).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof RecordNotFoundError) {
          return reply.code(404).send({ success: false, message: "Not found" });
        }
        if (err instanceof SystemRoleError) {
          return reply.code(403).send({ success: false, message: "System roles cannot be modified." });
        }
        if (err instanceof RoleNameConflictError) {
          return reply.code(409).send({ success: false, message: "Role name already exists" });
        }
        throw err;
      }
    },
  );

  fastify.delete<{ Params: { id: string; roleId: string } }>(
    "/tenants/:id/roles/:roleId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        await deleteTenantRole(request.superAdminDb!, {
          tenantId: request.params.id,
          roleId: request.params.roleId,
          superAdminId: request.superAdmin!.id,
        });
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof RecordNotFoundError) {
          return reply.code(404).send({ success: false, message: "Not found" });
        }
        if (err instanceof SystemRoleError) {
          return reply.code(403).send({ success: false, message: "System roles cannot be modified." });
        }
        if (err instanceof RoleInUseError) {
          return reply
            .code(409)
            .send({ success: false, message: "Role has users assigned; reassign them before deleting." });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: DepartmentWriteInput }>(
    "/tenants/:id/departments",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const body = request.body ?? ({} as DepartmentWriteInput);
      if (!body.name || !body.name.trim()) {
        return reply.code(400).send({ success: false, message: "name is required" });
      }
      try {
        const result = await createTenantDepartment(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
          input: body,
        });
        return reply.code(201).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof DepartmentValidationError) {
          return reply.code(422).send({ success: false, message: err.message });
        }
        if (err instanceof DepartmentNameConflictError) {
          return reply
            .code(409)
            .send({ success: false, message: "A department with this name already exists" });
        }
        throw err;
      }
    },
  );

  fastify.patch<{ Params: { id: string; departmentId: string }; Body: DepartmentWriteInput }>(
    "/tenants/:id/departments/:departmentId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      try {
        const result = await editTenantDepartment(request.superAdminDb!, {
          tenantId: request.params.id,
          departmentId: request.params.departmentId,
          superAdminId: request.superAdmin!.id,
          input: request.body ?? {},
        });
        return reply.code(200).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof RecordNotFoundError) {
          return reply.code(404).send({ success: false, message: "Not found" });
        }
        if (err instanceof DepartmentValidationError) {
          return reply.code(422).send({ success: false, message: err.message });
        }
        if (err instanceof DepartmentNameConflictError) {
          return reply
            .code(409)
            .send({ success: false, message: "A department with this name already exists" });
        }
        throw err;
      }
    },
  );

  fastify.get(
    "/tenants/:id/form-definitions",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const result = await getFormDefinitions(request.superAdminDb!);
      return { success: true, data: result };
    },
  );

  fastify.get<{ Params: { id: string }; Querystring: { formKey?: string } }>(
    "/tenants/:id/custom-fields",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      if (!request.query.formKey) {
        return reply.code(400).send({ success: false, message: "formKey is required" });
      }
      const result = await getTenantCustomFields(request.superAdminDb!, {
        tenantId: request.params.id,
        formKey: request.query.formKey,
      });
      return { success: true, data: result };
    },
  );

  fastify.post<{ Params: { id: string }; Body: CreateTenantCustomFieldInput }>(
    "/tenants/:id/custom-fields",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const body = request.body ?? ({} as CreateTenantCustomFieldInput);
      if (!body.formKey || !body.label || !body.label.trim() || !body.fieldType) {
        return reply
          .code(400)
          .send({ success: false, message: "formKey, label, and fieldType are required" });
      }
      if (!isValidFieldType(body.fieldType)) {
        return reply.code(400).send({ success: false, message: "Unrecognized fieldType" });
      }
      if ((body.fieldType === "select" || body.fieldType === "multiselect") && (!body.options || body.options.length === 0)) {
        return reply
          .code(400)
          .send({ success: false, message: "options is required for select/multiselect fields" });
      }
      try {
        const result = await createTenantCustomField(request.superAdminDb!, {
          tenantId: request.params.id,
          superAdminId: request.superAdmin!.id,
          input: body,
        });
        return reply.code(201).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof RecordNotFoundError) {
          return reply.code(404).send({ success: false, message: "Unknown form type" });
        }
        if (err instanceof FieldKeyConflictError) {
          return reply
            .code(409)
            .send({ success: false, message: "A field with this key already exists on this form" });
        }
        throw err;
      }
    },
  );

  fastify.patch<{ Params: { id: string; fieldId: string }; Body: EditTenantCustomFieldInput }>(
    "/tenants/:id/custom-fields/:fieldId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const body = request.body ?? ({} as EditTenantCustomFieldInput);
      if (body.fieldType && !isValidFieldType(body.fieldType)) {
        return reply.code(400).send({ success: false, message: "Unrecognized fieldType" });
      }
      try {
        const result = await editTenantCustomField(request.superAdminDb!, {
          tenantId: request.params.id,
          fieldId: request.params.fieldId,
          superAdminId: request.superAdmin!.id,
          input: body,
        });
        return reply.code(200).send({ success: true, data: result });
      } catch (err) {
        if (err instanceof RecordNotFoundError) {
          return reply.code(404).send({ success: false, message: "Not found" });
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
