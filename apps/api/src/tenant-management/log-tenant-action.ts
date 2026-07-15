import type { Db } from "../db/client";
import { tenantActionLog } from "../db/schema/tenant-action-log";

export type TenantAction = "edit" | "archive" | "reactivate" | "downgrade" | "delete" | "delete_recover";

/** FR-016: called inside the same transaction as the state change it records (data-model.md
 * `tenant_action_log`). `db` must be `request.superAdminDb` — see list-tenants.ts's own note. */
export async function logTenantAction(
  db: Db,
  params: { tenantId: string; superAdminId: string; action: TenantAction },
): Promise<void> {
  await db.insert(tenantActionLog).values({
    tenantId: params.tenantId,
    superAdminId: params.superAdminId,
    action: params.action,
  });
}
