import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema/tenants";
import { TenantNotFoundError, TenantLockedError } from "./errors";
import { logTenantAction } from "./log-tenant-action";
import { revokeTenantSessions } from "./revoke-tenant-sessions";

/**
 * contracts/tenant-management-api.md `POST /tenants/:id/archive` (spec FR-007, FR-009; research.md
 * §3, §8). `db` must be `request.superAdminDb`. Bulk session revoke runs in the same transaction as
 * the `archivedAt` write — the "immediate termination" guarantee is this write plus the
 * `tenant-user-context.ts` gate amendment (Foundational T009), not this write alone.
 */
export async function archiveTenant(
  db: Db,
  params: { tenantId: string; superAdminId: string },
): Promise<{ id: string; isArchived: boolean }> {
  const [current] = await db
    .select({ archivedAt: tenants.archivedAt })
    .from(tenants)
    .where(eq(tenants.id, params.tenantId));

  if (!current) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }
  if (current.archivedAt) {
    // FR-009: already archived — no-op, not an error, and no duplicate log entry.
    return { id: params.tenantId, isArchived: true };
  }

  await db.update(tenants).set({ archivedAt: new Date() }).where(eq(tenants.id, params.tenantId));
  await revokeTenantSessions(db, params.tenantId);
  await logTenantAction(db, { tenantId: params.tenantId, superAdminId: params.superAdminId, action: "archive" });

  return { id: params.tenantId, isArchived: true };
}

/** contracts/tenant-management-api.md `POST /tenants/:id/reactivate` (spec FR-008). */
export async function reactivateTenant(
  db: Db,
  params: { tenantId: string; superAdminId: string },
): Promise<{ id: string; isArchived: boolean }> {
  const [current] = await db
    .select({ archivedAt: tenants.archivedAt, deletionRequestedAt: tenants.deletionRequestedAt })
    .from(tenants)
    .where(eq(tenants.id, params.tenantId));

  if (!current) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }
  if (current.deletionRequestedAt) {
    throw new TenantLockedError("This tenant is pending deletion — recover it instead");
  }
  if (!current.archivedAt) {
    return { id: params.tenantId, isArchived: false };
  }

  await db.update(tenants).set({ archivedAt: null }).where(eq(tenants.id, params.tenantId));
  await logTenantAction(db, {
    tenantId: params.tenantId,
    superAdminId: params.superAdminId,
    action: "reactivate",
  });

  return { id: params.tenantId, isArchived: false };
}
