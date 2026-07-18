import { eq, and, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { courseCategories } from "../db/schema/course-categories";

/**
 * research.md §3/§4. Resolves a category by name (case-insensitive, whitespace-trimmed) within the
 * caller's tenant, auto-creating it if no match exists — no separate category-management step
 * required (spec FR-001b). Race-safe via a single `INSERT ... ON CONFLICT DO NOTHING RETURNING`
 * against `course_categories_tenant_id_name_unique`, re-selecting if the insert lost the race to a
 * concurrent identical insert.
 */
export async function resolveOrCreateCourseCategory(
  tenantDb: Db,
  tenantId: string,
  name: string,
  createdByUserId: string | null,
): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();

  const [existing] = await tenantDb
    .select({ id: courseCategories.id, name: courseCategories.name })
    .from(courseCategories)
    .where(and(eq(courseCategories.tenantId, tenantId), sql`lower(${courseCategories.name}) = lower(${trimmed})`));
  if (existing) {
    return existing;
  }

  // No explicit `target` — `course_categories` has exactly one unique constraint
  // (`course_categories_tenant_id_name_unique`, an expression index over `lower(name)` that Drizzle's
  // typed `target` API can't reference directly since it only accepts plain columns), so an untargeted
  // `ON CONFLICT DO NOTHING` unambiguously applies to it.
  const [inserted] = await tenantDb
    .insert(courseCategories)
    .values({ tenantId, name: trimmed, createdByUserId })
    .onConflictDoNothing()
    .returning({ id: courseCategories.id, name: courseCategories.name });
  if (inserted) {
    return inserted;
  }

  // Lost the race to a concurrent identical insert — re-select to fetch the row it just created.
  const [resolved] = await tenantDb
    .select({ id: courseCategories.id, name: courseCategories.name })
    .from(courseCategories)
    .where(and(eq(courseCategories.tenantId, tenantId), sql`lower(${courseCategories.name}) = lower(${trimmed})`));
  return resolved;
}
