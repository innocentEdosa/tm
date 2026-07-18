import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema/users";
import { departments } from "../db/schema/departments";
import { userRoles, roles } from "../db/schema/roles";
import { memberActionLog } from "../db/schema/member-action-log";
import { getFormFieldsForTenant } from "./tenant-scoped-form-fields";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";
import { roleExistsForTenant, departmentIsActiveForTenant } from "./add-tenant-member";
import { RecordNotFoundError } from "./errors";

export interface EditTenantMemberInput {
  fullName?: string;
  roleId?: string;
  departmentId?: string | null;
  customFieldValues?: Record<string, unknown>;
  archived?: boolean;
}

export interface EditTenantMemberValidationErrors {
  errors: { fieldKey: string; message: string }[];
}

/** research.md §1 — tenant-scoped equivalent of `tenant-auth/team-write-validation.ts`'s
 * `isDepartmentLeader`, which relies on `request.tenantDb`'s ambient RLS scoping. */
async function isDepartmentLeaderForTenant(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.tenantId, tenantId),
        // managerId/assistantManagerId — either match
        eq(departments.managerId, userId),
      ),
    );
  if (row) return true;
  const [assistantRow] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.assistantManagerId, userId)));
  return !!assistantRow;
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `PATCH /tenants/:id/members/:memberId`
 * (spec FR-003). `db` must be `request.superAdminDb`. Mirrors `PATCH /tenant/team/:userId`'s
 * (Spec 013) exact validation order — reusing Spec 021's `roleExistsForTenant`/
 * `departmentIsActiveForTenant` unchanged — with every lookup explicitly filtered by `tenantId`
 * (research.md §1). Unlike the tenant-side route, there is no "cannot archive your own account"
 * check — a Super Admin session has no comparable `users.id` (plan.md data-model.md).
 */
export async function editTenantMember(
  db: Db,
  params: { tenantId: string; memberId: string; superAdminId: string; input: EditTenantMemberInput },
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; kind: "validation"; errors: { fieldKey: string; message: string }[] }
  | { ok: false; kind: "role_not_found" }
  | { ok: false; kind: "department_not_active" }
  | { ok: false; kind: "leader_archive_blocked" }
> {
  const { tenantId, memberId, superAdminId, input } = params;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)));
  if (!existing) {
    throw new RecordNotFoundError(`No member ${memberId} for tenant ${tenantId}`);
  }

  if (input.roleId !== undefined && !(await roleExistsForTenant(db, tenantId, input.roleId))) {
    return { ok: false, kind: "role_not_found" };
  }
  if (
    input.departmentId != null &&
    !(await departmentIsActiveForTenant(db, tenantId, input.departmentId))
  ) {
    return { ok: false, kind: "department_not_active" };
  }

  if (input.archived === true) {
    if (await isDepartmentLeaderForTenant(db, tenantId, memberId)) {
      return { ok: false, kind: "leader_archive_blocked" };
    }
  }

  const fields = input.customFieldValues
    ? await getFormFieldsForTenant(db, tenantId, "member")
    : [];
  if (input.customFieldValues) {
    const errors = validateCustomFieldValues(input.customFieldValues, fields);
    if (errors.length > 0) {
      return { ok: false, kind: "validation", errors };
    }
  }

  if (input.fullName !== undefined || input.departmentId !== undefined || input.archived !== undefined) {
    await db
      .update(users)
      .set({
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, memberId));
  }

  if (input.roleId !== undefined) {
    await db.update(userRoles).set({ roleId: input.roleId }).where(eq(userRoles.userId, memberId));
  }

  if (input.customFieldValues) {
    await writeCustomFieldValues(db, tenantId, "member", memberId, input.customFieldValues, fields);
  }

  await db.insert(memberActionLog).values({
    tenantId,
    memberId,
    superAdminId,
    action: "member_edited",
  });

  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      archivedAt: users.archivedAt,
      departmentId: users.departmentId,
      roleId: roles.id,
      roleName: roles.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(users.id, memberId));

  return {
    ok: true,
    data: {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      roleId: row.roleId,
      roleName: row.roleName,
      departmentId: row.departmentId,
      archived: row.archivedAt !== null,
    },
  };
}
