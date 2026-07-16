import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema/users";
import { memberActionLog } from "../db/schema/member-action-log";
import { hashPassword } from "../platform-auth/password";
import { revokeUserSessions } from "../tenant-management/revoke-tenant-sessions";
import { generateResetPassword } from "./generate-password";
import { MemberNotFoundError } from "./errors";

/**
 * contracts/super-admin-tenant-console-api.md `POST /tenants/:id/members/:memberId/reset-password`
 * (spec FR-008–FR-011, Clarifications). `db` must be `request.superAdminDb` — every write here is
 * part of the same per-request transaction `super-admin-context.ts` already opens, mirroring
 * `archive-tenant.ts`'s own sequential-await pattern (no separate `db.transaction()` needed).
 *
 * The generated password is system-generated (never Super-Admin-typed) and returned exactly once —
 * never persisted anywhere, never emailed. `must_change_password`/`otp_expires_at` are deliberately
 * left untouched: the member is NOT forced to change this password at next login (spec
 * Clarifications) — this is a permanent credential, not an OTP.
 */
export async function resetMemberPassword(
  db: Db,
  params: { tenantId: string; memberId: string; superAdminId: string },
): Promise<{ generatedPassword: string }> {
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, params.tenantId), eq(users.id, params.memberId)));

  if (!member) {
    throw new MemberNotFoundError(`No member ${params.memberId} for tenant ${params.tenantId}`);
  }

  const generatedPassword = generateResetPassword();
  const passwordHash = await hashPassword(generatedPassword);

  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, params.memberId));

  await revokeUserSessions(db, { tenantId: params.tenantId, memberId: params.memberId });

  await db.insert(memberActionLog).values({
    tenantId: params.tenantId,
    memberId: params.memberId,
    superAdminId: params.superAdminId,
    action: "password_reset",
  });

  return { generatedPassword };
}
