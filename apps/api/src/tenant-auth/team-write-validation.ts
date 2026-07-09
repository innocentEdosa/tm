import { and, eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { roles } from "../db/schema/roles";
import { departments } from "../db/schema/departments";

/** Spec 013 (Add/Edit Team Member), research.md §1 — the current `POST /tenant-auth/team` handler
 * inserts a client-supplied `roleId` with zero existence check, which throws an uncaught FK
 * violation on a bad id (a raw 500) *after* the `users` row has already been committed. Both this
 * check and `departmentIsActive` below MUST run before any write, shared by the `POST` fix and the
 * new `PATCH /tenant/team/:userId` route — RLS already scopes `roles`/`departments` reads to the
 * caller's own tenant, so a cross-tenant id simply returns no row, no explicit tenant filter needed. */
export async function roleExists(tenantDb: Db, roleId: string): Promise<boolean> {
  const [row] = await tenantDb.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
  return !!row;
}

/** Spec 013, research.md §1 — mirrors the Active-only check the current `POST` handler already
 * performs, now shared with `PATCH` and moved earlier (before any write) in both. */
export async function departmentIsActive(tenantDb: Db, departmentId: string): Promise<boolean> {
  const [row] = await tenantDb
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.status, "active")));
  return !!row;
}

/** Spec 013, archive capability — a "full soft-delete": archiving is blocked while the member is
 * still a department's Manager or Assistant Manager, per direct product decision (their leadership
 * role must be reassigned first, rather than silently clearing it). */
export async function isDepartmentLeader(tenantDb: Db, userId: string): Promise<boolean> {
  const [row] = await tenantDb
    .select({ id: departments.id })
    .from(departments)
    .where(or(eq(departments.managerId, userId), eq(departments.assistantManagerId, userId)));
  return !!row;
}
