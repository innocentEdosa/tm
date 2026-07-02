import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The platform root record for a tenant — its `id` IS the `tenant_id` every other tenant-scoped
 * table (this feature's and Spec 1's) is keyed by (data-model.md `tenants`). `id` is generated in
 * application code, not the database, so it can be set via `SET LOCAL app.tenant_id` before this
 * row is inserted (research.md §1) — RLS `WITH CHECK` then passes for exactly this one row.
 *
 * `status` only ever gets written as `'trial'` by this feature (FR-004); `active`/`suspended`/
 * `cancelled` are allowed by the CHECK so a future lifecycle spec can add transition logic without
 * an ALTER TABLE, but nothing here writes those values.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull().unique(),
    industry: text("industry"),
    primaryContactName: text("primary_contact_name").notNull(),
    primaryContactEmail: text("primary_contact_email").notNull(),
    primaryContactPhone: text("primary_contact_phone"),
    status: text("status").notNull().default("trial"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "tenants_status_check",
      sql`${table.status} IN ('trial', 'active', 'suspended', 'cancelled')`,
    ),
  ],
);
