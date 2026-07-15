import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema/tenants";
import { TenantNotFoundError, TenantLockedError } from "./errors";
import { logTenantAction } from "./log-tenant-action";

export class TenantAlreadyAtLowestStatusError extends Error {}

/**
 * contracts/tenant-management-api.md `POST /tenants/:id/downgrade` (spec FR-010, FR-011, FR-012;
 * research.md §4). Single fixed transition — `active` → `trial` — no general status lattice. `db`
 * must be `request.superAdminDb`.
 */
export async function downgradeTenant(
  db: Db,
  params: { tenantId: string; superAdminId: string },
): Promise<{ id: string; status: string }> {
  const [current] = await db
    .select({
      status: tenants.status,
      archivedAt: tenants.archivedAt,
      deletionRequestedAt: tenants.deletionRequestedAt,
    })
    .from(tenants)
    .where(eq(tenants.id, params.tenantId));

  if (!current) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }
  if (current.archivedAt || current.deletionRequestedAt) {
    throw new TenantLockedError("Reactivate this tenant before downgrading it");
  }
  if (current.status !== "active") {
    throw new TenantAlreadyAtLowestStatusError("This tenant cannot be downgraded further");
  }

  const [updated] = await db
    .update(tenants)
    .set({ status: "trial", updatedAt: new Date() })
    .where(eq(tenants.id, params.tenantId))
    .returning({ id: tenants.id, status: tenants.status });

  await logTenantAction(db, {
    tenantId: params.tenantId,
    superAdminId: params.superAdminId,
    action: "downgrade",
  });

  return updated;
}
