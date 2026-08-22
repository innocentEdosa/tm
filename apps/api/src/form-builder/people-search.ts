import { and, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema/users";
import { roles } from "../db/schema/roles";

export interface PersonOrRoleResult {
  type: "user" | "role";
  id: string;
  label: string;
  sublabel?: string;
}

const RESULT_LIMIT_PER_KIND = 20;

/**
 * Backs `people_select` (multiple form responses feature — TNA's "Affected Individuals" field,
 * spec follow-up): search both users and roles in one call, in the same tenant-scoped `Db` the
 * caller already resolved (session-authenticated `request.tenantDb`, or the magic-link
 * transaction `apps/api/src/tna/public-tna-routes.ts`'s `withAssignment` sets up) — this function
 * trusts that scoping, it never resolves a tenant itself. Mirrors `user-search`'s own
 * `ILIKE`-on-name/email pattern (`tenant-form-builder-routes.ts`), extended to also match a
 * role's name; `roles.tenantId IS NULL` (platform role templates, never assignable directly) is
 * excluded — only a tenant's own real, assignable roles are a valid "affected individuals" target.
 */
export async function searchPeopleAndRoles(tenantDb: Db, search: string): Promise<PersonOrRoleResult[]> {
  const trimmed = search.trim();
  if (!trimmed) return [];
  const pattern = `%${trimmed}%`;

  const userRows = await tenantDb
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(or(sql`${users.fullName} ILIKE ${pattern}`, sql`${users.email} ILIKE ${pattern}`))
    .limit(RESULT_LIMIT_PER_KIND);

  const roleRows = await tenantDb
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(sql`${roles.name} ILIKE ${pattern}`, sql`${roles.tenantId} IS NOT NULL`))
    .limit(RESULT_LIMIT_PER_KIND);

  return [
    ...userRows.map((u): PersonOrRoleResult => ({ type: "user", id: u.id, label: u.fullName, sublabel: u.email })),
    ...roleRows.map((r): PersonOrRoleResult => ({ type: "role", id: r.id, label: r.name })),
  ];
}

/** Resolves previously-selected ids back into display info (the stored `people_select` value is
 * just `{ type, id }` pairs plus the cached label/sublabel — this backs re-resolving a *stale*
 * or externally-constructed value, not the normal render path, which already has its own cached
 * label). `userIds`/`roleIds` are pre-split by the caller (each entry's own `type`). */
export async function resolvePeopleAndRoles(tenantDb: Db, userIds: string[], roleIds: string[]): Promise<PersonOrRoleResult[]> {
  const userRows = userIds.length
    ? await tenantDb.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(inArray(users.id, userIds))
    : [];
  const roleRows = roleIds.length ? await tenantDb.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, roleIds)) : [];
  return [
    ...userRows.map((u): PersonOrRoleResult => ({ type: "user", id: u.id, label: u.fullName, sublabel: u.email })),
    ...roleRows.map((r): PersonOrRoleResult => ({ type: "role", id: r.id, label: r.name })),
  ];
}
