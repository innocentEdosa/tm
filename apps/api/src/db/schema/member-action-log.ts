import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { superAdmins } from "./super-admins";

/**
 * Append-only record of a Super Admin Tenant Console action targeting one member
 * (data-model.md `member_action_log`). Same platform-level, no-RLS, Super-Admin-route-only-access
 * posture as `tenant_action_log` — kept as a separate table rather than adding a nullable member
 * column to that one, since `tenant_action_log` records actions *about a tenant*, not actions
 * *about one of a tenant's members* (research.md §6). `tm_app` is granted `INSERT`/`SELECT` only, no
 * `UPDATE`/`DELETE` (migration 0058) — append-only.
 *
 * `tenantId`, `memberId`, and `superAdminId` are all nullable with `onDelete: "set null"`, mirroring
 * `tenant_action_log`'s own treatment of `tenantId`/`superAdminId`: the audit trail of *who reset
 * whose password and when* must survive a later, unrelated deletion of the tenant, the member, or the
 * Super Admin account itself, never being blocked by or cascade-deleted alongside any of them.
 */
export const memberActionLog = pgTable("member_action_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  memberId: uuid("member_id").references(() => users.id, { onDelete: "set null" }),
  superAdminId: uuid("super_admin_id").references(() => superAdmins.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
