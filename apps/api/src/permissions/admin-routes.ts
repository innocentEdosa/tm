import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { permissions } from "../db/schema/permissions";
import { roleTemplates, roleTemplatePermissions } from "../db/schema/role-templates";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";

/**
 * contracts/super-admin-catalog-api.md — read-only, platform-connection-context routes. Guarded by
 * `requireSuperAdminSession` (Super Admin Authentication spec) — this supersedes the original
 * `requirePlatformPermission`/`tm_platform_reader` mechanism from the Roles & Permissions Model
 * spec, which has been retired (see drizzle/README.md). Super Admin access here is now a binary
 * "are you a Super Admin" check, not a per-permission-key check — the new `super_admins` identity
 * has no permission-catalog granularity of its own.
 */
const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/admin/permissions",
    { preHandler: [requireSuperAdminSession] },
    async () => {
      const rows = await fastify.db
        .select({
          id: permissions.id,
          key: permissions.key,
          displayName: permissions.displayName,
          description: permissions.description,
          category: permissions.category,
        })
        .from(permissions);

      return { success: true, data: rows };
    },
  );

  fastify.get(
    "/admin/role-templates",
    { preHandler: [requireSuperAdminSession] },
    async () => {
      const templates = await fastify.db
        .select({
          id: roleTemplates.id,
          key: roleTemplates.key,
          name: roleTemplates.name,
          description: roleTemplates.description,
          isPlatformOnly: roleTemplates.isPlatformOnly,
        })
        .from(roleTemplates);

      const mappings = await fastify.db
        .select({
          roleTemplateId: roleTemplatePermissions.roleTemplateId,
          permissionKey: permissions.key,
        })
        .from(roleTemplatePermissions)
        .innerJoin(permissions, eq(permissions.id, roleTemplatePermissions.permissionId));

      const permissionKeysByTemplate = new Map<string, string[]>();
      for (const { roleTemplateId, permissionKey } of mappings) {
        const keys = permissionKeysByTemplate.get(roleTemplateId) ?? [];
        keys.push(permissionKey);
        permissionKeysByTemplate.set(roleTemplateId, keys);
      }

      const data = templates.map((template) => ({
        ...template,
        permissions: permissionKeysByTemplate.get(template.id) ?? [],
      }));

      return { success: true, data };
    },
  );
};

export default adminRoutes;
