import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { requirePermission } from "./require-permission";
import { roles, rolePermissions } from "../db/schema/roles";
import { permissions } from "../db/schema/permissions";

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/** contracts/tenant-role-management-api.md — all operate through `request.tenantDb` (RLS-scoped). */
const tenantRoleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.patch<{
    Params: { roleId: string };
    Body: { name?: string; description?: string; permissionKeys?: string[] };
  }>(
    "/tenant/roles/:roleId",
    { preHandler: [requirePermission("manage_roles")] },
    async (request, reply) => {
      const { roleId } = request.params;
      const { name, description, permissionKeys } = request.body ?? {};

      const [existing] = await request.tenantDb.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
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
    { preHandler: [requirePermission("manage_roles")] },
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
    { preHandler: [requirePermission("manage_roles")] },
    async (request, reply) => {
      const { roleId } = request.params;

      const [existing] = await request.tenantDb.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
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
