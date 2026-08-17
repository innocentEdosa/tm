import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { tnaExerciseTargets, type TnaTargetType } from "../db/schema/tna-exercises";
import { departments } from "../db/schema/departments";
import { userRoles } from "../db/schema/roles";

export interface ResolvedTnaParticipant {
  userId: string;
  departmentId: string | null;
  sourceTargetType: TnaTargetType;
}

/** Snapshot resolution, run once at Start (see tenant-tna-routes.ts) — never re-run afterward, per
 * the deliberate departure from `course_assignments`' fully-dynamic model documented on
 * `tna_assignments`. Department targets (including the `targetsAllDepartments` toggle) resolve to
 * that department's manager + assistant manager (`departments.managerId`/`.assistantManagerId` —
 * the only "department owner" concept this schema has); role targets resolve to every current
 * holder of that role; user targets resolve directly. Dedupes by `(userId, departmentId ?? null)`
 * so a person reachable through more than one rule for the *same* department context (e.g. also
 * directly user-targeted while already a department manager for a different department) doesn't
 * get two rows for that context — first rule to reach them wins for logging `sourceTargetType`,
 * which is informational only. */
export interface ResolveTnaParticipantsResult {
  participants: ResolvedTnaParticipant[];
  /** Department ids that were targeted (directly or via `targetsAllDepartments`) but have neither
   * a manager nor an assistant manager set, so contributed zero participants — surfaced to HR as a
   * warning at Start rather than silently dropped. */
  departmentsWithNoManager: string[];
}

export async function resolveTnaParticipants(
  tenantDb: Db,
  tnaExerciseId: string,
  targetsAllDepartments: boolean,
): Promise<ResolveTnaParticipantsResult> {
  const targets = await tenantDb
    .select()
    .from(tnaExerciseTargets)
    .where(eq(tnaExerciseTargets.tnaExerciseId, tnaExerciseId));

  const targetedDepartmentIds = targets
    .filter((t) => t.targetType === "department")
    .map((t) => t.departmentId!);
  const targetedRoleIds = targets.filter((t) => t.targetType === "role").map((t) => t.roleId!);
  const directUserIds = targets.filter((t) => t.targetType === "user").map((t) => t.userId!);

  const participantsByKey = new Map<string, ResolvedTnaParticipant>();
  function add(userId: string, departmentId: string | null, sourceTargetType: TnaTargetType) {
    const key = `${userId}::${departmentId ?? "GENERAL"}`;
    if (!participantsByKey.has(key)) {
      participantsByKey.set(key, { userId, departmentId, sourceTargetType });
    }
  }

  const departmentRows = targetsAllDepartments
    ? await tenantDb
        .select({ id: departments.id, managerId: departments.managerId, assistantManagerId: departments.assistantManagerId })
        .from(departments)
        .where(eq(departments.status, "active"))
    : targetedDepartmentIds.length > 0
      ? await tenantDb
          .select({ id: departments.id, managerId: departments.managerId, assistantManagerId: departments.assistantManagerId })
          .from(departments)
          .where(and(inArray(departments.id, targetedDepartmentIds), eq(departments.status, "active")))
      : [];

  const departmentsWithNoManager: string[] = [];
  for (const dept of departmentRows) {
    if (!dept.managerId && !dept.assistantManagerId) {
      departmentsWithNoManager.push(dept.id);
      continue;
    }
    if (dept.managerId) add(dept.managerId, dept.id, "department");
    if (dept.assistantManagerId) add(dept.assistantManagerId, dept.id, "department");
  }

  if (targetedRoleIds.length > 0) {
    const roleMembers = await tenantDb
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(inArray(userRoles.roleId, targetedRoleIds));
    for (const member of roleMembers) add(member.userId, null, "role");
  }

  for (const userId of directUserIds) add(userId, null, "user");

  return { participants: Array.from(participantsByKey.values()), departmentsWithNoManager };
}
