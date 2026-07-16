import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema/users";
import { collectSubtreeIds } from "../departments/department-hierarchy";

export type TrainingNeedVisibilityScope =
  | { kind: "all" }
  | { kind: "department"; departmentIds: string[] }
  | { kind: "no_department_assigned" };

/**
 * Resolves a caller's effective visibility scope for training needs (spec 014, research.md §2) —
 * structurally identical to `resolveTeamVisibilityScope` (`tenant-auth/team-visibility.ts`), reusing
 * the same unmodified `collectSubtreeIds`. Callers must already be known to hold
 * `training_request.view.all` or `training_request.view.department` (the route's own
 * `requireAnyPermission` preHandler) — `viewAll: false` here means `training_request.view.department`
 * is guaranteed true, no need to pass it too.
 *
 * Draft-privacy (Clarification session Q3) is NOT encoded here — a `{kind: "all"}` scope still
 * includes Draft rows unless the caller also filters by `status = 'submitted'`; every route that
 * reads through this scope for the org-wide case is responsible for applying that filter itself
 * (contracts/training-needs-api.md), since "visible at all" and "visible including drafts" are two
 * different questions this helper only answers the first of.
 */
export async function resolveTrainingNeedVisibilityScope(
  tenantDb: Db,
  callerUserId: string,
  viewAll: boolean,
): Promise<TrainingNeedVisibilityScope> {
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
