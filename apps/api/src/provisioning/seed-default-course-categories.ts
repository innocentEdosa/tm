import type { Db } from "../db/client";
import { courseCategoryTemplates, courseCategories } from "../db/schema/course-categories";

/**
 * data-model.md `course_categories`. `tenantDb` MUST already be running inside a transaction with
 * `app.tenant_id` set to `tenantId` (research.md §2) — this function relies on RLS `WITH CHECK` to
 * scope its own inserts and passes no explicit tenant_id filter of its own, mirroring
 * `seedDefaultDepartmentsForTenant` (apps/api/src/provisioning/seed-default-departments.ts).
 */
export async function seedDefaultCourseCategoriesForTenant(
  tenantDb: Db,
  tenantId: string,
): Promise<{ categoriesCreated: number }> {
  const templates = await tenantDb
    .select({ id: courseCategoryTemplates.id, name: courseCategoryTemplates.name })
    .from(courseCategoryTemplates);

  if (templates.length > 0) {
    await tenantDb.insert(courseCategories).values(
      templates.map((template) => ({
        tenantId,
        name: template.name,
        sourceTemplateId: template.id,
      })),
    );
  }

  return { categoriesCreated: templates.length };
}
