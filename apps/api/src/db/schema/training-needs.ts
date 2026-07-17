import { pgTable, uuid, text, timestamp, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { departments } from "./departments";
import { users } from "./users";

/**
 * A single department-level training-need request (spec 014 data-model.md `training_needs`).
 * Deliberately minimal fixed field set (`title`, `priority`, `departmentId`, `status`) — everything
 * else a real tenant wants to capture (Function, Type of Gap, Observable Incidences, etc.) is a
 * tenant-configured custom field through the existing Custom Fields Framework (Spec 010), never a
 * column here (research.md §5, spec Clarifications). `departmentId` uses the same `RESTRICT`
 * convention as `users.departmentId` — departments are archived (status change), never hard-deleted,
 * so this reference always stays valid.
 */
export const trainingNeeds = pgTable(
  "training_needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    departmentId: uuid("department_id")
      .notNull()
      .references((): AnyPgColumn => departments.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    priority: text("priority").notNull(),
    status: text("status").notNull().default("draft"),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Approval step (follow-up to spec 014's own flagged Assumption — no approval workflow was in
     * v1 scope). A dedicated `training_request.approve` permission, not `training_request.manage.*`
     * — approving is a governance action a tenant may grant to a role independently of edit/delete
     * rights. */
    approvedByUserId: uuid("approved_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("training_needs_tenant_id_department_id_idx").on(table.tenantId, table.departmentId),
    index("training_needs_tenant_id_status_idx").on(table.tenantId, table.status),
    check("training_needs_priority_check", sql`${table.priority} in ('low', 'medium', 'high')`),
    check("training_needs_status_check", sql`${table.status} in ('draft', 'submitted', 'approved')`),
  ],
);
