import { pgTable, uuid, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A tenant-owned, tenant-extensible business-objective category — mirrors `course_categories`
 * exactly (resolve-or-create-by-name, no dedicated write endpoint, no platform-seeded template set
 * since objective categories are free-form per tenant unlike course categories).
 */
export const businessObjectiveCategories = pgTable(
  "business_objective_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive per-tenant uniqueness — same technique as course_categories_tenant_id_name_unique,
    // the conflict target resolveOrCreateBusinessObjectiveCategory upserts against.
    uniqueIndex("business_objective_categories_tenant_id_name_unique").on(table.tenantId, sql`lower(${table.name})`),
  ],
);
