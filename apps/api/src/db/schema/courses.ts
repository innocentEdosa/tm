import { pgTable, uuid, text, timestamp, numeric, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { courseCategories } from "./course-categories";
import { users } from "./users";

/**
 * A tenant-scoped course-catalog entry (data-model.md `courses`). Metadata only in this spec — no
 * content/curriculum relationship (spec FR-012, Clarifications); a future Course Content spec attaches
 * records here by `id` without requiring a change to this table. `status` transitions freely between
 * `draft`/`active`/`archived` via a plain update — no restricted transition graph (spec FR-005,
 * Clarifications); archiving never deletes the row (FR-011).
 */
export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    title: text("title").notNull(),
    description: text("description"),
    categoryId: uuid("category_id")
      .notNull()
      .references((): AnyPgColumn => courseCategories.id, { onDelete: "restrict" }),
    deliveryMode: text("delivery_mode").notNull(),
    durationValue: numeric("duration_value", { precision: 6, scale: 2, mode: "number" }).notNull(),
    durationUnit: text("duration_unit").notNull(),
    provider: text("provider"),
    cost: numeric("cost", { precision: 12, scale: 2, mode: "number" }),
    status: text("status").notNull().default("draft"),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("courses_tenant_id_status_idx").on(table.tenantId, table.status),
    index("courses_tenant_id_category_id_idx").on(table.tenantId, table.categoryId),
    check(
      "courses_delivery_mode_check",
      sql`${table.deliveryMode} in ('in_person', 'virtual', 'self_paced', 'blended')`,
    ),
    check("courses_duration_unit_check", sql`${table.durationUnit} in ('minutes', 'hours', 'days')`),
    check("courses_status_check", sql`${table.status} in ('draft', 'active', 'archived')`),
    check("courses_duration_value_positive_check", sql`${table.durationValue} > 0`),
    check("courses_cost_non_negative_check", sql`${table.cost} is null or ${table.cost} >= 0`),
  ],
);
