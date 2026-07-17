import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema/users";
import { roles, userRoles } from "../db/schema/roles";
import { departments } from "../db/schema/departments";
import { tenants } from "../db/schema/tenants";
import { memberActionLog } from "../db/schema/member-action-log";
import { generateOneTimePassword, otpExpiryFromNow } from "../tenant-auth/otp";
import { hashPassword } from "../platform-auth/password";
import { sendMemberInviteEmail } from "../tenant-auth/mailer";
import { TenantNotFoundError, RoleNotFoundError, DepartmentNotActiveError, EmailConflictError } from "./errors";

export interface AddTenantMemberInput {
  fullName: string;
  email: string;
  roleId: string;
  departmentId?: string;
}

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/** research.md §1 — `tenant-auth/team-write-validation.ts`'s `roleExists` relies on
 * `request.tenantDb`'s ambient RLS scoping (no `tenant_id` filter of its own); `request.superAdminDb`
 * has no such scoping, so this explicitly-filtered equivalent is required to avoid a role belonging
 * to a different tenant validating successfully. */
async function roleExistsForTenant(db: Db, tenantId: string, roleId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
  return !!row;
}

/** research.md §1 — same reasoning as `roleExistsForTenant` above, mirroring
 * `departmentIsActive`'s existing check plus an explicit `tenant_id` filter. */
async function departmentIsActiveForTenant(
  db: Db,
  tenantId: string,
  departmentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.tenantId, tenantId),
        eq(departments.status, "active"),
      ),
    );
  return !!row;
}

/**
 * contracts/super-admin-add-member-api.md `POST /tenants/:id/members` (spec FR-001–FR-008). `db`
 * must be `request.superAdminDb`. A straight port of `POST /tenant-auth/team`'s own logic (Specs
 * 012/013) — same validation order, same OTP/invite-email mechanics, same `member_action_log`
 * accountability pattern already established for the password-reset action (Spec 020) — with every
 * query explicitly filtered by `tenantId` (research.md §1), and `invited_by` left `NULL` (spec
 * FR-007) since a Super Admin has no tenant-scoped `users.id` to attribute it to. Works identically
 * regardless of the target tenant's status (spec FR-010) — no status check here.
 */
export async function addTenantMember(
  db: Db,
  params: { tenantId: string; superAdminId: string; input: AddTenantMemberInput },
): Promise<{ id: string; email: string }> {
  const { tenantId, superAdminId, input } = params;

  const [tenant] = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) {
    throw new TenantNotFoundError(`No tenant with id ${tenantId}`);
  }

  if (!(await roleExistsForTenant(db, tenantId, input.roleId))) {
    throw new RoleNotFoundError(`No role ${input.roleId} for tenant ${tenantId}`);
  }

  if (input.departmentId && !(await departmentIsActiveForTenant(db, tenantId, input.departmentId))) {
    throw new DepartmentNotActiveError(`No active department ${input.departmentId} for tenant ${tenantId}`);
  }

  const oneTimePassword = generateOneTimePassword();

  let createdUser: { id: string; email: string };
  try {
    [createdUser] = await db
      .insert(users)
      .values({
        tenantId,
        fullName: input.fullName,
        email: input.email.trim().toLowerCase(),
        passwordHash: await hashPassword(oneTimePassword),
        mustChangePassword: true,
        otpExpiresAt: otpExpiryFromNow(),
        departmentId: input.departmentId ?? null,
        invitedBy: null,
      })
      .returning({ id: users.id, email: users.email });
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      throw new EmailConflictError(`Email already in use at tenant ${tenantId}`);
    }
    throw err;
  }

  await db.insert(userRoles).values({ tenantId, userId: createdUser.id, roleId: input.roleId });

  await db.insert(memberActionLog).values({
    tenantId,
    memberId: createdUser.id,
    superAdminId,
    action: "member_added",
  });

  try {
    await sendMemberInviteEmail(createdUser.email, oneTimePassword, tenant.name);
  } catch (err) {
    // research.md §3 — sendMemberInviteEmail's own sendMail already swallows/logs a send failure
    // and never rejects; this catch is defensive only, mirroring the existing tenant-side route's
    // own posture, not a path expected to actually trigger.
    console.error(`Failed to send Super-Admin-console member invite email`, err);
  }

  return createdUser;
}
