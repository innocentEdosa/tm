import { desc, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions } from "../db/schema/custom-fields";

/** The framework-shipped form types every deployment ships via migration, never through the
 * runtime "create form type" route (FR-001/FR-004) — `department`/`member` from spec 010,
 * `business_objective` and `training_needs_analysis` (labeled "Training Request" in the product,
 * spec 020's rename) from their own specs, `tna_response` seeded by migration 0144. Used (not
 * `created_by_super_admin_id IS NULL`, which this column also nominally implies) because that
 * column is *also* `NULL` on rows inserted directly by this codebase's own integration-test
 * fixtures, which don't set a creator — a real signal in production, but not reliably
 * distinguishable from test noise in a shared dev database. `key` uniqueness is DB-enforced, so
 * no test fixture or Super Admin action can ever collide with one of these. */
const DEFAULT_FORM_TYPE_KEYS = ["department", "member", "business_objective", "training_needs_analysis", "tna_response"];

export interface FormTypeListRow {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  status: string;
  activeVersionId: string | null;
  createdAt: Date;
}

export interface ListFormTypesResult {
  forms: FormTypeListRow[];
  meta: { page: number; pageSize: number; total: number };
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * `GET /platform/forms` (contracts/form-builder-api.md), server-side paginated — mirrors
 * `apps/api/src/tenant-management/list-tenants.ts` exactly (page/pageSize/search convention,
 * `{ rows, meta }` shape), since the Platform Forms list has the same "grows past a
 * glance-able size" property once a Super Admin has created more than a handful of form types
 * (spec FR-001 makes that unbounded). `search` matches `name` or `key`, case-insensitive
 * substring, server-side.
 */
export async function listFormTypes(
  db: Db,
  options: { page?: number; pageSize?: number; search?: string; builtInFirst?: boolean } = {},
): Promise<ListFormTypesResult> {
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : DEFAULT_PAGE_SIZE;

  const search = options.search?.trim();
  const condition = search ? or(ilike(formDefinitions.name, `%${search}%`), ilike(formDefinitions.key, `%${search}%`)) : undefined;

  // `builtInFirst` surfaces every framework-shipped default (DEFAULT_FORM_TYPE_KEYS) ahead of any
  // runtime-created custom type, alphabetically within that group, so a Super Admin always sees
  // Department/Business Objective/etc. on page 1 regardless of how many custom (or test) form
  // types exist — used by both the main list and the "Create form" popover's quick list.
  const orderBy = options.builtInFirst
    ? [
        sql`(${inArray(formDefinitions.key, DEFAULT_FORM_TYPE_KEYS)}) DESC`,
        // Alphabetical within the built-in group (Business Objective, Department, …); the custom
        // group keeps its familiar most-recent-first order — a `CASE` per group rather than one
        // shared sort key, since mixing "alphabetical" and "newest" into a single column would
        // scramble one group to satisfy the other.
        sql`CASE WHEN ${inArray(formDefinitions.key, DEFAULT_FORM_TYPE_KEYS)} THEN ${formDefinitions.name} END ASC`,
        sql`CASE WHEN NOT ${inArray(formDefinitions.key, DEFAULT_FORM_TYPE_KEYS)} THEN ${formDefinitions.createdAt} END DESC`,
      ]
    : [desc(formDefinitions.createdAt)];

  const rows = await db
    .select({
      id: formDefinitions.id,
      key: formDefinitions.key,
      name: formDefinitions.name,
      description: formDefinitions.description,
      icon: formDefinitions.icon,
      status: formDefinitions.status,
      activeVersionId: formDefinitions.activeVersionId,
      createdAt: formDefinitions.createdAt,
    })
    .from(formDefinitions)
    .where(condition)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(formDefinitions)
    .where(condition);

  return { forms: rows, meta: { page, pageSize, total: count } };
}
