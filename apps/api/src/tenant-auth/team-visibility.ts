import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema/users";
import { collectSubtreeIds } from "../departments/department-hierarchy";

export type TeamVisibilityScope =
  | { kind: "all" }
  | { kind: "department"; departmentIds: string[] }
  | { kind: "no_department_assigned" };

/**
 * Resolves a caller's effective visibility scope for the team directory (spec 012, data-model.md
 * "Derived concepts"). `request.user` carries only `id`/`tenantId` (research.md §6) — a caller's own
 * department isn't available for free, so a `team.view.department`-only caller costs one extra
 * indexed lookup on `users.id` (the primary key) here. Callers must already be known to hold
 * `team.view.all` or `team.view.department` (the route's own `requireAnyPermission` preHandler) —
 * `viewAll: false` here means `team.view.department` is guaranteed true, no need to pass it too.
 */
export async function resolveTeamVisibilityScope(
  tenantDb: Db,
  callerUserId: string,
  viewAll: boolean,
): Promise<TeamVisibilityScope> {
  if (viewAll) {
    return { kind: "all" };
  }

  const [caller] = await tenantDb
    .select({ departmentId: users.departmentId })
    .from(users)
    .where(eq(users.id, callerUserId));

  if (!caller?.departmentId) {
    return { kind: "no_department_assigned" };
  }

  const departmentIds = await collectSubtreeIds(tenantDb, caller.departmentId);
  return { kind: "department", departmentIds };
}
