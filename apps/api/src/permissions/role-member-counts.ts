import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/** Every role's current member count, keyed by role id — used by `GET /tenant/roles` (data-model.md)
 * and by the frontend to decide whether an edit needs the impact-warning dialog (spec FR-010/FR-011)
 * or whether a delete should be blocked (spec FR-013), without a second round-trip per role. */
export async function getRoleMemberCounts(tenantDb: Db): Promise<Map<string, number>> {
  const result = await tenantDb.execute<{ role_id: string; count: number }>(
    sql`SELECT role_id, count(*)::int AS count FROM user_roles GROUP BY role_id`,
  );
  return new Map(result.rows.map((row) => [row.role_id, row.count]));
}
