import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { userSessions } from "../db/schema/user-sessions";

/** Shared by archive and delete (research.md §3, §8) — bulk-revokes every currently-live session for
 * a tenant, in the same transaction as the state change that should immediately block access. `db`
 * must be `request.superAdminDb`. */
export async function revokeTenantSessions(db: Db, tenantId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.tenantId, tenantId), isNull(userSessions.revokedAt)));
}

/** Super Admin Tenant Console spec, research.md §5 — same shape as `revokeTenantSessions`, scoped to
 * one member instead of an entire tenant. Both `tenantId` and `memberId` are filtered (not `memberId`
 * alone) so a `memberId` that does not actually belong to the tenant named in the route never revokes
 * a session it shouldn't. `db` must be `request.superAdminDb`. */
export async function revokeUserSessions(
  db: Db,
  params: { tenantId: string; memberId: string },
): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessions.tenantId, params.tenantId),
        eq(userSessions.userId, params.memberId),
        isNull(userSessions.revokedAt),
      ),
    );
}
