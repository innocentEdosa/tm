import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { superAdmins } from "./super-admins";

/**
 * Append-only record of a Tenant Management action (data-model.md `tenant_action_log`). Platform-
 * level, no RLS — same posture as `super_admin_sessions` — since only Super-Admin-only route
 * handlers ever read or write it (research.md §6). `tm_app` is granted `INSERT`/`SELECT` only, no
 * `UPDATE`/`DELETE` (migration 0056) — append-only, nothing in this codebase edits or removes a row
 * once written.
 *
 * `tenantId` is nullable with `onDelete: "set null"`, deliberately not `NOT NULL`/cascade: the
 * purge script (`scripts/purge-deleted-tenants.ts`) permanently deletes the `tenants` row itself
 * once a deletion's grace period elapses (FR-015b), and the audit trail of *who deleted what and
 * when* must survive that — the same "preserve history, don't cascade" precedent as
 * `users.invitedBy` (`onDelete: "set null"`), not the tenant-scoped-table precedent (which this
 * table structurally isn't, having no RLS policy of its own).
 *
 * `superAdminId` is nullable with the same `onDelete: "set null"` treatment, for the identical
 * reason on the other side of the row: a Super Admin account can itself be deleted (e.g. the
 * `seed-super-admin` script's own reset path), and that must never be blocked by — or silently
 * cascade-delete — this append-only log of actions they took while the account existed.
 */
export const tenantActionLog = pgTable("tenant_action_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  superAdminId: uuid("super_admin_id").references(() => superAdmins.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
