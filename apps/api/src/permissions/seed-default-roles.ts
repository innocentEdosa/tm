import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { roleTemplates, roleTemplatePermissions } from "../db/schema/role-templates";
import { roles, rolePermissions } from "../db/schema/roles";

/**
 * contracts/seed-default-roles-interface.md. `tenantDb` MUST already be running inside a
 * transaction with `app.tenant_id` set to `tenantId` (research.md §3-4) — this function relies on
 * RLS `WITH CHECK` to scope its own inserts and passes no explicit tenant_id filter of its own.
 * Excludes the Super Admin template (`is_platform_only = true`), which is seeded exactly once,
 * platform-wide, by 0007_seed_super_admin_role.sql — never per-tenant.
 */
export async function seedDefaultRolesForTenant(
  tenantDb: Db,
  tenantId: string,
): Promise<{ rolesCreated: number }> {
  const templates = await tenantDb
    .select({
      id: roleTemplates.id,
      name: roleTemplates.name,
      description: roleTemplates.description,
    })
    .from(roleTemplates)
    .where(eq(roleTemplates.isPlatformOnly, false));

  let rolesCreated = 0;

  for (const template of templates) {
    const [createdRole] = await tenantDb
      .insert(roles)
      .values({
        tenantId,
        name: template.name,
        description: template.description,
        sourceTemplateId: template.id,
      })
      .returning({ id: roles.id });

    const templatePermissions = await tenantDb
      .select({ permissionId: roleTemplatePermissions.permissionId })
      .from(roleTemplatePermissions)
      .where(eq(roleTemplatePermissions.roleTemplateId, template.id));

    if (templatePermissions.length > 0) {
      await tenantDb.insert(rolePermissions).values(
        templatePermissions.map((p) => ({
          roleId: createdRole.id,
          permissionId: p.permissionId,
        })),
      );
    }

    rolesCreated += 1;
  }

  return { rolesCreated };
}
