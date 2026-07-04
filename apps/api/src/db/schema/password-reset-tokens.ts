import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A forgotten-password reset token (data-model.md `password_reset_tokens`) — a separate mechanism
 * from a one-time password (research.md §5-6): this authorizes a reset action outside the normal
 * login form, whereas an OTP works through the normal login form itself. Same "resolve tenant
 * first" reasoning as `user_sessions` — standard `tenant_isolation` RLS policy, no narrow allowance.
 */
export const passwordResetTokens = pgTable("password_reset_tokens", {
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
  usedAt: timestamp("used_at", { withTimezone: true }),
});
