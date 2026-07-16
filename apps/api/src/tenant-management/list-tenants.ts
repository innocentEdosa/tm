import { desc, ilike, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema/tenants";

export interface TenantListRow {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  isArchived: boolean;
  isPendingDeletion: boolean;
  primaryContactName: string;
  primaryContactEmail: string;
  createdAt: Date;
}

export interface ListTenantsResult {
  tenants: TenantListRow[];
  meta: { page: number; pageSize: number; total: number };
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * contracts/tenant-management-api.md `GET /tenants` (spec FR-001, User Story 1). `db` must be
 * `request.superAdminDb` — this query relies on the `super_admin_full_access` RLS policy (migration
 * 0054, research.md §8) to see every tenant, not just the one matching an `app.tenant_id` that's
 * never set on this connection. Archived/pending-deletion tenants still appear (with their flag set,
 * not hidden) — a Super Admin needs to find them again to reactivate/recover.
 *
 * `search` (added for the Super Admin Tenant Console spec — the list grows past a glance-able size
 * once dozens of tenants exist) matches `name`, `subdomain`, or `primary_contact_email`,
 * case-insensitive substring, server-side — never a client-side filter of an already-fetched page.
 */
export async function listTenants(
  db: Db,
  options: { page?: number; pageSize?: number; search?: string } = {},
): Promise<ListTenantsResult> {
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : DEFAULT_PAGE_SIZE;

  const search = options.search?.trim();
  const condition = search
    ? or(
        ilike(tenants.name, `%${search}%`),
        ilike(tenants.subdomain, `%${search}%`),
        ilike(tenants.primaryContactEmail, `%${search}%`),
      )
    : undefined;

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      subdomain: tenants.subdomain,
      status: tenants.status,
      isArchived: sql<boolean>`${tenants.archivedAt} is not null`,
      isPendingDeletion: sql<boolean>`${tenants.deletionRequestedAt} is not null`,
      primaryContactName: tenants.primaryContactName,
      primaryContactEmail: tenants.primaryContactEmail,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(condition)
    .orderBy(desc(tenants.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenants)
    .where(condition);

  return { tenants: rows, meta: { page, pageSize, total: count } };
}
