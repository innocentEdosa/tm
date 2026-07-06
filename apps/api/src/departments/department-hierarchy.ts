import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/**
 * research.md §3/§7, data-model.md "Derived concepts". Every query here runs through the caller's
 * `request.tenantDb` (RLS-scoped, research.md §4) — none needs its own `tenant_id` filter, and a
 * cross-tenant id simply returns no rows rather than needing an explicit rejection.
 */

/**
 * Walks upward from `startDepartmentId` through `parent_department_id`, returning
 * `[startDepartmentId, its parent, its grandparent, ...]` up to the root (max 3 entries at this
 * spec's depth cap). Used two ways by the route handlers:
 *  - Cycle check: if the department being saved appears anywhere in this array (called with the
 *    *proposed parent's* id), the write would create a cycle.
 *  - Depth-cap check: if this array's length is already 3, the proposed parent cannot take another
 *    child (that child would be a 4th level).
 */
export async function findAncestorChain(tenantDb: Db, startDepartmentId: string): Promise<string[]> {
  const result = await tenantDb.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_department_id, 1 AS depth
      FROM departments
      WHERE id = ${startDepartmentId}
      UNION ALL
      SELECT d.id, d.parent_department_id, c.depth + 1
      FROM departments d
      JOIN chain c ON d.id = c.parent_department_id
    )
    SELECT id FROM chain ORDER BY depth
  `);
  return result.rows.map((row) => (row as { id: string }).id);
}

/** `departmentId` itself plus every descendant, any depth — used for the deletion-block rollup
 * member count (FR-016) and would also back a future "delete/reparent subtree" feature. */
export async function collectSubtreeIds(tenantDb: Db, departmentId: string): Promise<string[]> {
  const result = await tenantDb.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM departments WHERE id = ${departmentId}
      UNION ALL
      SELECT d.id FROM departments d JOIN subtree s ON d.parent_department_id = s.id
    )
    SELECT id FROM subtree
  `);
  return result.rows.map((row) => (row as { id: string }).id);
}

/** Spec FR-008's "has child departments" deletion-block reason. */
export async function hasChildren(tenantDb: Db, departmentId: string): Promise<boolean> {
  const result = await tenantDb.execute(
    sql`SELECT 1 FROM departments WHERE parent_department_id = ${departmentId} LIMIT 1`,
  );
  return result.rows.length > 0;
}

/** Spec FR-015 — direct members only, not summed across descendants (those show as their own rows
 * with their own counts in the expandable tree). */
export async function directMemberCount(tenantDb: Db, departmentId: string): Promise<number> {
  const result = await tenantDb.execute(
    sql`SELECT count(*)::int AS count FROM users WHERE department_id = ${departmentId}`,
  );
  return (result.rows[0] as { count: number }).count;
}

/** Spec FR-016 — the department plus every descendant, summed. This wider scope is intentional:
 * it's exactly what the deletion-blocking rule itself blocks on. */
export async function subtreeMemberCount(tenantDb: Db, departmentId: string): Promise<number> {
  const result = await tenantDb.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM departments WHERE id = ${departmentId}
      UNION ALL
      SELECT d.id FROM departments d JOIN subtree s ON d.parent_department_id = s.id
    )
    SELECT count(*)::int AS count FROM users WHERE department_id IN (SELECT id FROM subtree)
  `);
  return (result.rows[0] as { count: number }).count;
}
