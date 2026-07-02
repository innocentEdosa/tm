import type { Db } from "../db/client";
import { departmentTemplates, departments } from "../db/schema/departments";

/**
 * contracts/seed-default-departments-interface.md. `tenantDb` MUST already be running inside a
 * transaction with `app.tenant_id` set to `tenantId` (research.md §1) — this function relies on RLS
 * `WITH CHECK` to scope its own inserts and passes no explicit tenant_id filter of its own, mirroring
 * `seedDefaultRolesForTenant` (apps/api/src/permissions/seed-default-roles.ts).
 */
export async function seedDefaultDepartmentsForTenant(
  tenantDb: Db,
  tenantId: string,
): Promise<{ departmentsCreated: number }> {
  const templates = await tenantDb
    .select({ id: departmentTemplates.id, name: departmentTemplates.name })
    .from(departmentTemplates);

  if (templates.length > 0) {
    await tenantDb.insert(departments).values(
      templates.map((template) => ({
        tenantId,
        name: template.name,
        sourceTemplateId: template.id,
      })),
    );
  }

  return { departmentsCreated: templates.length };
}
