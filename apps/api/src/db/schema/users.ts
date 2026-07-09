import { pgTable, uuid, text, boolean, integer, timestamp, unique, type AnyPgColumn } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { departments } from "./departments";

/**
 * The initial admin's account, created during provisioning (data-model.md `users`). Extended here
 * (Tenant Authentication Configuration spec) with credential columns rather than a competing table,
 * per Spec 2's own anticipation (research.md §1, §6 there). `passwordHash` also holds a one-time
 * password's hash while `mustChangePassword` is true — login verification has no separate code path
 * for "is this an OTP" (data-model.md, research.md §6). `departmentId` (Department Management spec,
 * 009) is this user's single "home" department — mutually referencing with `departments.ts`
 * (`managerId`/`assistantManagerId` point back here), safe under Drizzle's lazy `.references()`
 * callback (research.md §9). `invitedBy` (Team Member Directory spec, 012) self-references this same
 * table (the creating user), `onDelete: "set null"` — deleting the inviter must not cascade-delete
 * or block deleting the people they invited (data-model.md "New: users.invited_by").
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
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, {
      onDelete: "restrict",
    }),
    invitedBy: uuid("invited_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    /** Add/Edit Team Member spec (013), archive capability — NULL means active. A "full soft-delete":
     * archiving blocks login (checked at login-time and on every request via tenant-user-context.ts)
     * and hides the member from the default directory list, but preserves every historical reference
     * (invited_by, department manager/assistant_manager, custom field values). Reversible — clearing
     * this column restores login access. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("users_tenant_id_email_unique").on(table.tenantId, table.email)],
);
