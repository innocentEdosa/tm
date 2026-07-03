import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Platform-level operator account, entirely separate from any tenant-scoped user table — no
 * `tenant_id` column, no RLS policy (data-model.md `super_admins`). `tm_app` is granted `SELECT`/
 * `UPDATE` only, deliberately no `INSERT` — the only code path that can create a row here is the
 * standalone seed script, connecting as the migration/owner role (research.md §7).
 */
export const superAdmins = pgTable("super_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/**
 * One row per Super Admin login (data-model.md `super_admin_sessions`). Stores only a hash of the
 * session token — the raw token lives solely in the httpOnly cookie sent to the browser
 * (research.md §2). No `tenant_id`, no RLS.
 */
export const superAdminSessions = pgTable("super_admin_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  superAdminId: uuid("super_admin_id")
    .notNull()
    .references(() => superAdmins.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
