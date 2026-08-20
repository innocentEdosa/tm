import { pgTable, uuid, text, date, numeric, timestamp, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";
import { departments } from "./departments";
import { businessObjectiveCategories } from "./business-objective-categories";

/**
 * A single company/strategy-level business objective (Strategy nav). `ownerDepartmentId` is
 * required and `RESTRICT`-on-delete — an objective always needs a responsible owning department
 * (departments are archived, never hard-deleted, same convention as `training_needs.department_id`).
 * `categoryId` resolves through the tenant-extensible `business_objective_categories` table (same
 * resolve-or-create-by-name pattern as `courses.category_id`), rather than a fixed enum, so a caller
 * can search existing categories or create a new one inline. `baselineValue`/`targetValue` are plain
 * `numeric` (no unit column) since "Metric / Key Result" is a free-text label describing what's being
 * measured. Only `title`, `ownerDepartmentId`, and `dueDate` are actually required — `categoryId` and
 * `metricName` are nullable (left blank when the caller skips them), `priority` always carries a
 * default ("medium") since its radio control can never be blank.
 */
export const businessObjectives = pgTable(
  "business_objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    title: text("title").notNull(),
    categoryId: uuid("category_id").references(
      (): AnyPgColumn => businessObjectiveCategories.id,
      { onDelete: "restrict" },
    ),
    description: text("description"),
    ownerDepartmentId: uuid("owner_department_id")
      .notNull()
      .references((): AnyPgColumn => departments.id, { onDelete: "restrict" }),
    dueDate: date("due_date").notNull(),
    priority: text("priority").notNull().default("medium"),
    metricName: text("metric_name"),
    baselineValue: numeric("baseline_value", { precision: 14, scale: 2, mode: "number" }),
    targetValue: numeric("target_value", { precision: 14, scale: 2, mode: "number" }),
    status: text("status").notNull().default("not_started"),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    /** Lifecycle archive (drawer's "Archive objective" action) — deliberately separate from
     * `status` above, which tracks progress toward the objective, not whether it's still active.
     * Same reversible, hidden-from-the-default-list convention as `users.archivedAt`/
     * `tenants.archivedAt`, not a hard delete. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("business_objectives_tenant_id_status_idx").on(table.tenantId, table.status),
    index("business_objectives_tenant_id_due_date_idx").on(table.tenantId, table.dueDate),
    index("business_objectives_tenant_id_owner_department_id_idx").on(table.tenantId, table.ownerDepartmentId),
    index("business_objectives_tenant_id_category_id_idx").on(table.tenantId, table.categoryId),
    check("business_objectives_priority_check", sql`${table.priority} in ('low', 'medium', 'high')`),
    check(
      "business_objectives_status_check",
      sql`${table.status} in ('not_started', 'on_track', 'at_risk', 'done')`,
    ),
  ],
);
