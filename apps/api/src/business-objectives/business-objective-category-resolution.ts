import { eq, and, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { businessObjectiveCategories } from "../db/schema/business-objective-categories";

/**
 * Mirrors `resolveOrCreateCourseCategory` (course-category-resolution.ts) exactly. Resolves a
 * category by name (case-insensitive, whitespace-trimmed) within the caller's tenant, auto-creating
 * it if no match exists — no separate category-management step required. Race-safe via a single
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING` against
 * `business_objective_categories_tenant_id_name_unique`, re-selecting if the insert lost the race to
 * a concurrent identical insert.
 */
export async function resolveOrCreateBusinessObjectiveCategory(
  tenantDb: Db,
  tenantId: string,
  name: string,
  createdByUserId: string | null,
): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();

  const [existing] = await tenantDb
    .select({ id: businessObjectiveCategories.id, name: businessObjectiveCategories.name })
    .from(businessObjectiveCategories)
    .where(
      and(
        eq(businessObjectiveCategories.tenantId, tenantId),
        sql`lower(${businessObjectiveCategories.name}) = lower(${trimmed})`,
      ),
    );
  if (existing) {
    return existing;
  }

  const [inserted] = await tenantDb
    .insert(businessObjectiveCategories)
    .values({ tenantId, name: trimmed, createdByUserId })
    .onConflictDoNothing()
    .returning({ id: businessObjectiveCategories.id, name: businessObjectiveCategories.name });
  if (inserted) {
    return inserted;
  }

  const [resolved] = await tenantDb
    .select({ id: businessObjectiveCategories.id, name: businessObjectiveCategories.name })
    .from(businessObjectiveCategories)
    .where(
      and(
        eq(businessObjectiveCategories.tenantId, tenantId),
        sql`lower(${businessObjectiveCategories.name}) = lower(${trimmed})`,
      ),
    );
  return resolved;
}
