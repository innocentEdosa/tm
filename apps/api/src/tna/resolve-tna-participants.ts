import { eq, and, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { tnaExerciseTargets, type TnaTargetType } from "../db/schema/tna-exercises";
import { departments } from "../db/schema/departments";
import { userRoles } from "../db/schema/roles";
import { users } from "../db/schema/users";

export interface ResolvedTnaParticipant {
  userId: string;
  departmentId: string | null;
  sourceTargetType: TnaTargetType;
}

/** Snapshot resolution, re-run by `syncTnaAssignments` (tenant-tna-routes.ts) on every create/edit
 * while an exercise is still a draft, and once more at Start — never re-run once the exercise is
 * active or beyond, per the deliberate departure from `course_assignments`' fully-dynamic model
 * documented on `tna_assignments`. Department targets (including the `targetsAllDepartments` toggle) resolve to
 * that department's manager + assistant manager (`departments.managerId`/`.assistantManagerId` —
 * the only "department owner" concept this schema has); role targets resolve to every current
 * holder of that role; user targets resolve directly. Dedupes by `(userId, departmentId ?? null)`
 * so a person reachable through more than one rule for the *same* department context (e.g. also
 * directly user-targeted while already a department manager for a different department) doesn't
 * get two rows for that context — first rule to reach them wins for logging `sourceTargetType`,
 * which is informational only.
 *
 * Archived users (`users.archivedAt` set) are excluded from every resolution path — they can't log
 * in, so assigning them would permanently drag down completion% with no way for them to ever act on
 * it. A department whose manager and assistant manager are either unset or archived is folded into
 * `departmentsWithNoManager` exactly like a department with no manager set at all, so HR sees an
 * accurate warning either way instead of a silent under-count. */
export interface ResolveTnaParticipantsResult {
  participants: ResolvedTnaParticipant[];
  /** Department ids that were targeted (directly or via `targetsAllDepartments`) but have no *active*
   * manager or assistant manager (unset, or archived), so contributed zero participants — surfaced to
   * HR as a warning at Start rather than silently dropped. */
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

  const departmentOwnerIds = Array.from(
    new Set(
      departmentRows.flatMap((d) => [d.managerId, d.assistantManagerId]).filter((id): id is string => !!id),
    ),
  );
  const activeDepartmentOwnerIds =
    departmentOwnerIds.length > 0
      ? new Set(
          (
            await tenantDb
              .select({ id: users.id })
              .from(users)
              .where(and(inArray(users.id, departmentOwnerIds), isNull(users.archivedAt)))
          ).map((r) => r.id),
        )
      : new Set<string>();

  const departmentsWithNoManager: string[] = [];
  for (const dept of departmentRows) {
    const activeManagerId = dept.managerId && activeDepartmentOwnerIds.has(dept.managerId) ? dept.managerId : null;
    const activeAssistantManagerId =
      dept.assistantManagerId && activeDepartmentOwnerIds.has(dept.assistantManagerId) ? dept.assistantManagerId : null;
    if (!activeManagerId && !activeAssistantManagerId) {
      departmentsWithNoManager.push(dept.id);
      continue;
    }
    if (activeManagerId) add(activeManagerId, dept.id, "department");
    if (activeAssistantManagerId) add(activeAssistantManagerId, dept.id, "department");
  }

  if (targetedRoleIds.length > 0) {
    const roleMembers = await tenantDb
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(inArray(userRoles.roleId, targetedRoleIds), isNull(users.archivedAt)));
    for (const member of roleMembers) add(member.userId, null, "role");
  }

  if (directUserIds.length > 0) {
    const activeDirectUsers = await tenantDb
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, directUserIds), isNull(users.archivedAt)));
    for (const row of activeDirectUsers) add(row.id, null, "user");
  }

  return { participants: Array.from(participantsByKey.values()), departmentsWithNoManager };
}
