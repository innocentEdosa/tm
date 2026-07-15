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
