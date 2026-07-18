import type { Db } from "../db/client";
import { tenantConfigActionLog } from "../db/schema/tenant-config-action-log";

export type TenantConfigEntityType = "role" | "department" | "custom_field";

/**
 * Super Admin Edit Tenant Configuration spec (022), research.md §3 — a single-row insert into
 * `tenant_config_action_log`, shared by the role/department/custom-field handlers. `db` must be
 * `request.superAdminDb` (the table has no RLS, but every write goes through the same connection as
 * the rest of the request for consistency with the module's own convention).
 */
export async function logTenantConfigAction(
  db: Db,
  params: {
    tenantId: string;
    superAdminId: string;
    entityType: TenantConfigEntityType;
    entityId: string;
    action: string;
  },
): Promise<void> {
  await db.insert(tenantConfigActionLog).values({
    tenantId: params.tenantId,
    superAdminId: params.superAdminId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
  });
}
