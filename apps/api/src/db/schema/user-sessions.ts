import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A tenant user's server-verified login session (data-model.md `user_sessions`). Unlike Spec 4's
 * subdomain lookup, validating a session never needs a narrow RLS allowance — `tenant_id` is always
 * independently resolved from the subdomain *before* this table is queried, so the standard
 * `tenant_isolation` policy alone makes a session from a different tenant invisible (research.md
 * §3), which is also how spec FR-012 is satisfied.
 */
export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
