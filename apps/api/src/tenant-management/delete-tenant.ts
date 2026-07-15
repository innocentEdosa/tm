import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema/tenants";
import { TenantNotFoundError, TenantDeleteConfirmationMismatchError, TenantNotPendingDeletionError } from "./errors";
import { logTenantAction } from "./log-tenant-action";
import { revokeTenantSessions } from "./revoke-tenant-sessions";

/** Grace-period length before a pending-deletion tenant is permanently purged (FR-015b). A
 * deployment-config value, not fixed by the spec (plan.md Assumptions — flagged for stakeholder
 * sign-off); defaults to 30 days if unset. */
export function deletionGracePeriodDays(): number {
  const raw = process.env.TENANT_DELETION_GRACE_PERIOD_DAYS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * contracts/tenant-management-api.md `POST /tenants/:id/delete` (spec FR-013, FR-014, FR-015;
 * research.md §3, §8). `db` must be `request.superAdminDb`. Requires `confirmTenantName` to exactly
 * match the tenant's current name before anything is written — the explicit confirmation step FR-013
 * requires.
 */
export async function deleteTenant(
  db: Db,
  params: { tenantId: string; superAdminId: string; confirmTenantName?: string },
): Promise<{ id: string; isPendingDeletion: boolean; purgeAt: Date }> {
  const [current] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, params.tenantId));

  if (!current) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }
  if (!params.confirmTenantName || params.confirmTenantName !== current.name) {
    throw new TenantDeleteConfirmationMismatchError("Confirmation name does not match this tenant");
  }

  const now = new Date();
  const purgeAt = new Date(now.getTime() + deletionGracePeriodDays() * 24 * 60 * 60 * 1000);

  await db
    .update(tenants)
    .set({ deletionRequestedAt: now, deletionPurgeAt: purgeAt, updatedAt: now })
    .where(eq(tenants.id, params.tenantId));
  await revokeTenantSessions(db, params.tenantId);
  await logTenantAction(db, { tenantId: params.tenantId, superAdminId: params.superAdminId, action: "delete" });

  return { id: params.tenantId, isPendingDeletion: true, purgeAt };
}

/** contracts/tenant-management-api.md `POST /tenants/:id/recover` (spec FR-015a). */
export async function recoverTenant(
  db: Db,
  params: { tenantId: string; superAdminId: string },
): Promise<{ id: string; isPendingDeletion: boolean }> {
  const [current] = await db
    .select({ deletionRequestedAt: tenants.deletionRequestedAt })
    .from(tenants)
    .where(eq(tenants.id, params.tenantId));

  if (!current) {
    // Deliberately indistinguishable from "never existed" — a purged tenant leaves no row to tell
    // the two cases apart, and nothing tenant-identifying should be inferable from this response
    // (contracts/tenant-management-api.md).
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }
  if (!current.deletionRequestedAt) {
    throw new TenantNotPendingDeletionError("This tenant is not pending deletion");
  }

  await db
    .update(tenants)
    .set({ deletionRequestedAt: null, deletionPurgeAt: null, updatedAt: new Date() })
    .where(eq(tenants.id, params.tenantId));
  await logTenantAction(db, {
    tenantId: params.tenantId,
    superAdminId: params.superAdminId,
    action: "delete_recover",
  });

  return { id: params.tenantId, isPendingDeletion: false };
}
