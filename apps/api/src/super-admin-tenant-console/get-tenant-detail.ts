import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema/tenants";
import { TenantNotFoundError } from "./errors";

export interface TenantDetail {
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

/**
 * contracts/super-admin-tenant-console-api.md `GET /tenants/:id` (spec FR-003). `db` must be
 * `request.superAdminDb`; same field set as Tenant Management's existing list row
 * (data-model.md Read-model shapes), but resolving exactly one tenant via an explicit
 * `WHERE id = :tenantId` — never relying on this connection's ambient RLS context (research.md §1).
 * Works identically regardless of the tenant's status (spec FR-013 — no archived/pending-deletion
 * check here, unlike `editTenant`'s `TenantLockedError`).
 */
export async function getTenantDetail(db: Db, params: { tenantId: string }): Promise<TenantDetail> {
  const [row] = await db
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
    .where(eq(tenants.id, params.tenantId));

  if (!row) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }

  return row;
}
