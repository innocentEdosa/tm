import { desc, ilike, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions } from "../db/schema/custom-fields";

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
  options: { page?: number; pageSize?: number; search?: string } = {},
): Promise<ListFormTypesResult> {
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : DEFAULT_PAGE_SIZE;

  const search = options.search?.trim();
  const condition = search ? or(ilike(formDefinitions.name, `%${search}%`), ilike(formDefinitions.key, `%${search}%`)) : undefined;

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
    .orderBy(desc(formDefinitions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(formDefinitions)
    .where(condition);

  return { forms: rows, meta: { page, pageSize, total: count } };
}
