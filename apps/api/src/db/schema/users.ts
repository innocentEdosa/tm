import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * The initial admin's account, created during provisioning (data-model.md `users`). Deliberately
 * auth-free — no password hash, no SSO linkage. Spec 3 (auth method selection) is expected to
 * extend this same table with auth-specific columns, not create a competing table (research.md §6).
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("users_tenant_id_email_unique").on(table.tenantId, table.email)],
);
