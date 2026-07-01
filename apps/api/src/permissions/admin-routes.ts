import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { permissions } from "../db/schema/permissions";
import { roleTemplates, roleTemplatePermissions } from "../db/schema/role-templates";
import { requirePlatformPermission } from "./require-platform-permission";

/** contracts/super-admin-catalog-api.md — read-only, platform-connection-context routes. */
const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/admin/permissions",
    { preHandler: [requirePlatformPermission("view_permission_catalog")] },
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
    { preHandler: [requirePlatformPermission("view_permission_catalog")] },
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
