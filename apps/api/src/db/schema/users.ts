import { pgTable, uuid, text, boolean, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * The initial admin's account, created during provisioning (data-model.md `users`). Extended here
 * (Tenant Authentication Configuration spec) with credential columns rather than a competing table,
 * per Spec 2's own anticipation (research.md §1, §6 there). `passwordHash` also holds a one-time
 * password's hash while `mustChangePassword` is true — login verification has no separate code path
 * for "is this an OTP" (data-model.md, research.md §6).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("users_tenant_id_email_unique").on(table.tenantId, table.email)],
);
