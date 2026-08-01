import type { FastifyPluginAsync } from "fastify";
import { eq, inArray, ne } from "drizzle-orm";
import { requireAnyPermission } from "./require-permission";
import { roles, rolePermissions } from "../db/schema/roles";
import { permissions } from "../db/schema/permissions";
import { getRoleMemberCounts } from "./role-member-counts";

const SYSTEM_ROLE_MESSAGE = "System roles cannot be modified.";

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/** contracts/tenant-roles-management-api.md — all operate through `request.tenantDb` (RLS-scoped). */
const tenantRoleRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tenant/roles — spec FR-001/FR-002, data-model.md "Role list row". Every role visible to
  // the tenant (RLS already scopes this), each with its permission keys, isSystem, and memberCount.
  // Also readable by `course.manage`, which needs the role list to populate the course-assignment
  // picker's role target.
  fastify.get(
    "/tenant/roles",
    { preHandler: [requireAnyPermission("manage_roles", "roles.read", "course.manage")] },
    async (request) => {
      const allRoles = await request.tenantDb.select().from(roles);
      const rolePerms = await request.tenantDb
        .select({ roleId: rolePermissions.roleId, key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
      const keysByRole = new Map<string, string[]>();
      for (const row of rolePerms) {
        const list = keysByRole.get(row.roleId) ?? [];
        list.push(row.key);
        keysByRole.set(row.roleId, list);
      }
      const memberCounts = await getRoleMemberCounts(request.tenantDb);

      const data = allRoles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissionKeys: keysByRole.get(role.id) ?? [],
        isSystem: role.sourceTemplateId !== null,
        memberCount: memberCounts.get(role.id) ?? 0,
      }));

      return { success: true, data };
    },
  );

  // GET /tenant/permission-catalog — spec FR-007/FR-008, data-model.md "Permission catalog entry".
  // Flat list; grouping by category is a frontend concern (research.md §4). Excludes the `platform`
  // category — those keys (`view_permission_catalog`, `provision_tenant`) are only ever checked by
  // Super-Admin-session routes (`requireSuperAdminSession`), never by `requirePermission()` against
  // a tenant role, so granting them to a custom tenant role would be a meaningless no-op checkbox.
  fastify.get(
    "/tenant/permission-catalog",
    { preHandler: [requireAnyPermission("manage_roles", "roles.read")] },
    async (request) => {
      const rows = await request.tenantDb
        .select({
          id: permissions.id,
          key: permissions.key,
          displayName: permissions.displayName,
          description: permissions.description,
          category: permissions.category,
        })
        .from(permissions)
        .where(ne(permissions.category, "platform"));
      return { success: true, data: rows };
    },
  );

  fastify.patch<{
    Params: { roleId: string };
    Body: { name?: string; description?: string; permissionKeys?: string[] };
  }>(
    "/tenant/roles/:roleId",
    { preHandler: [requireAnyPermission("manage_roles", "roles.edit")] },
    async (request, reply) => {
      const { roleId } = request.params;
      const { name, description, permissionKeys } = request.body ?? {};

      const [existing] = await request.tenantDb
        .select({ id: roles.id, sourceTemplateId: roles.sourceTemplateId })
        .from(roles)
        .where(eq(roles.id, roleId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      // research.md §2/FR-005 — system roles (derived from a platform role template) can never be
      // edited, even via a direct API call, not only hidden in the UI.
      if (existing.sourceTemplateId !== null) {
        return reply.code(403).send({ success: false, message: SYSTEM_ROLE_MESSAGE });
      }

      if (name !== undefined || description !== undefined) {
        await request.tenantDb
          .update(roles)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            updatedAt: new Date(),
          })
          .where(eq(roles.id, roleId));
      }

      if (permissionKeys !== undefined) {
        await request.tenantDb.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        if (permissionKeys.length > 0) {
          const perms = await request.tenantDb
            .select({ id: permissions.id })
            .from(permissions)
            .where(inArray(permissions.key, permissionKeys));
          if (perms.length > 0) {
            await request.tenantDb.insert(rolePermissions).values(
              perms.map((p) => ({ roleId, permissionId: p.id })),
            );
          }
        }
      }

      const [updated] = await request.tenantDb.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.id, roleId));
      const finalPermissions = await request.tenantDb
        .select({ key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(rolePermissions.roleId, roleId));

      return {
        success: true,
        data: { id: updated.id, name: updated.name, permissionKeys: finalPermissions.map((p) => p.key) },
      };
    },
  );

  fastify.post<{
    Body: { name: string; description?: string; permissionKeys?: string[] };
  }>(
    "/tenant/roles",
    { preHandler: [requireAnyPermission("manage_roles", "roles.create")] },
    async (request, reply) => {
      const { name, description, permissionKeys = [] } = request.body;

      let createdRoleId: string;
      try {
        const [created] = await request.tenantDb
          .insert(roles)
          .values({ tenantId: request.user!.tenantId, name, description })
          .returning({ id: roles.id });
        createdRoleId = created.id;
      } catch (err) {
        if (pgErrorCode(err) === "23505") {
          return reply.code(409).send({ success: false, message: "Role name already exists" });
        }
        throw err;
      }

      if (permissionKeys.length > 0) {
        const perms = await request.tenantDb
          .select({ id: permissions.id })
          .from(permissions)
          .where(inArray(permissions.key, permissionKeys));
        if (perms.length > 0) {
          await request.tenantDb.insert(rolePermissions).values(
            perms.map((p) => ({ roleId: createdRoleId, permissionId: p.id })),
          );
        }
      }

      const finalPermissions = await request.tenantDb
        .select({ key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(rolePermissions.roleId, createdRoleId));

      return reply
        .code(201)
        .send({ success: true, data: { id: createdRoleId, name, permissionKeys: finalPermissions.map((p) => p.key) } });
    },
  );

  fastify.delete<{ Params: { roleId: string } }>(
    "/tenant/roles/:roleId",
    { preHandler: [requireAnyPermission("manage_roles", "roles.delete")] },
    async (request, reply) => {
      const { roleId } = request.params;

      const [existing] = await request.tenantDb
        .select({ id: roles.id, sourceTemplateId: roles.sourceTemplateId })
        .from(roles)
        .where(eq(roles.id, roleId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      // research.md §2/FR-005 — checked before the member-assignment check below, so a system role
      // with zero members still correctly reports "cannot be modified," not a silent success.
      if (existing.sourceTemplateId !== null) {
        return reply.code(403).send({ success: false, message: SYSTEM_ROLE_MESSAGE });
      }

      try {
        await request.tenantDb.delete(roles).where(eq(roles.id, roleId));
      } catch (err) {
        if (pgErrorCode(err) === "23503") {
          return reply
            .code(409)
            .send({ success: false, message: "Role has users assigned; reassign them before deleting." });
        }
        throw err;
      }

      return reply.code(204).send();
    },
  );
};

export default tenantRoleRoutes;
