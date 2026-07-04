import { pgTable, uuid, text, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";

/**
 * Which login method(s) are enabled for a tenant (data-model.md `tenant_auth_methods`) — one row
 * per *enabled* method, not a single enum column, since more than one may be enabled simultaneously
 * (spec FR-002). "At least one enabled" (FR-006) is enforced in application code, not here — Postgres
 * has no clean way to express "at least one row per tenant_id" as a table constraint.
 */
export const tenantAuthMethods = pgTable(
  "tenant_auth_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    method: text("method").notNull(),
    enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tenant_auth_methods_tenant_id_method_unique").on(table.tenantId, table.method),
    check(
      "tenant_auth_methods_method_check",
      sql`${table.method} IN ('email_password', 'microsoft', 'google_workspace', 'zoho')`,
    ),
  ],
);
