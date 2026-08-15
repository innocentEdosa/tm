import type { Db } from "../db/client";
import { businessObjectiveCategories } from "../db/schema/business-objective-categories";

/**
 * No separate templates table (unlike `course_category_templates`) — objective categories are
 * tenant-extensible from the start via `resolveOrCreateBusinessObjectiveCategory`, so a fixed
 * default set only needs to exist as a plain constant here and in the backfill migration
 * (0136_backfill_business_objective_categories_existing_tenants.sql), not a queryable global row set.
 */
export const DEFAULT_BUSINESS_OBJECTIVE_CATEGORY_NAMES = [
  "Growth",
  "Revenue",
  "Operations",
  "Customer",
  "Product",
  "People",
  "Financial",
  "Other",
] as const;

export async function seedDefaultBusinessObjectiveCategoriesForTenant(
  tenantDb: Db,
  tenantId: string,
): Promise<{ categoriesCreated: number }> {
  await tenantDb
    .insert(businessObjectiveCategories)
    .values(DEFAULT_BUSINESS_OBJECTIVE_CATEGORY_NAMES.map((name) => ({ tenantId, name })));

  return { categoriesCreated: DEFAULT_BUSINESS_OBJECTIVE_CATEGORY_NAMES.length };
}
