import { pgTable, uuid, text, date, boolean, timestamp, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";
import { departments } from "./departments";
import { roles } from "./roles";

/**
 * An HR-initiated Training Needs Analysis exercise/campaign (Strategy nav) — distinct from
 * Training Request (`training_needs` table, `training_request.*` permissions; that feature was
 * itself originally named "Training Needs Analysis" under spec 014, then renamed under spec 020
 * specifically to free this name up for the real, HR-initiated exercise spec 014 explicitly
 * deferred: "TNA is not organized around HR-initiated recurring 'cycles' or 'campaigns'... in v1
 * ... A cycle/campaign concept could be layered on top later without breaking this data model.").
 * This is that layer — a genuinely separate table/permission/form-key namespace (`tna_*`,
 * `tna.manage`/`tna.view`, form key `tna_response`), never reusing Training Request's.
 *
 * Status is a 5-state HR-review workflow (`draft` → `active` → `closed` → `under_review` →
 * `committed`) — deliberately more states than Training Request's own `draft/submitted/approved`,
 * per explicit product direction: "Under Review" is a real, HR-triggered transition (distinct from
 * merely `closed`), not just a UI mode layered on `closed`.
 *
 * No `start_date` column — HR only sets a deadline (`end_date`) at creation. The exercise's actual
 * start is `startedAt` below, recorded automatically the moment HR clicks Start; there is no
 * separate "planned start date" concept to configure ahead of time.
 */
export const tnaExercises = pgTable(
  "tna_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    title: text("title").notNull(),
    description: text("description"),
    endDate: date("end_date").notNull(),
    status: text("status").notNull().default("draft"),
    // Convenience toggle so HR doesn't have to hand-pick every department into
    // `tna_exercise_targets` — resolved at Start time to every active department's manager +
    // assistant manager, same as if every department had been individually targeted. Department/
    // role/user rows in `tna_exercise_targets` still apply on top of this (e.g. an exercise can
    // target "all departments" plus a specific extra role).
    targetsAllDepartments: boolean("targets_all_departments").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    committedByUserId: uuid("committed_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    // Archive is a separate, reversible-in-the-database-only lifecycle change (hidden from the
    // default list, mirrors `business_objectives.archivedAt`) — distinct from `status`, which
    // tracks the exercise's own workflow stage (draft/active/closed/under_review/committed). Only
    // a `closed` exercise can be archived (see the `/archive` route) — an exercise still being
    // worked (`active`/`under_review`) or already the tenant's committed record shouldn't disappear
    // from view this way.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tna_exercises_tenant_id_status_idx").on(table.tenantId, table.status),
    check(
      "tna_exercises_status_check",
      sql`${table.status} in ('draft', 'active', 'closed', 'under_review', 'committed')`,
    ),
  ],
);

export const TNA_TARGET_TYPES = ["department", "role", "user"] as const;
export type TnaTargetType = (typeof TNA_TARGET_TYPES)[number];

/**
 * Who a TNA exercise is targeted at — one row per target, mirroring `course_assignments`'
 * assignee-type shape exactly (department/role/user, exactly one FK set matching the type). No
 * `'all'` type here (unlike `course_assignments`) — "all departments" is `tna_exercises
 * .targetsAllDepartments` instead, since it's a whole-exercise mode toggle, not an individual
 * target row. Resolved into `tna_assignments` once, at Start (see `resolve-tna-participants.ts`)
 * — these rows are the targeting *rule*, never themselves the participant list.
 */
export const tnaExerciseTargets = pgTable(
  "tna_exercise_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tnaExerciseId: uuid("tna_exercise_id")
      .notNull()
      .references((): AnyPgColumn => tnaExercises.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references((): AnyPgColumn => roles.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tna_exercise_targets_tenant_id_exercise_id_idx").on(table.tenantId, table.tnaExerciseId),
    // Partial-unique guards, mirroring course_assignments' own idiom — at most one row per
    // (exercise, specific target).
    uniqueIndex("tna_exercise_targets_exercise_department_unique")
      .on(table.tnaExerciseId, table.departmentId)
      .where(sql`${table.departmentId} is not null`),
    uniqueIndex("tna_exercise_targets_exercise_role_unique")
      .on(table.tnaExerciseId, table.roleId)
      .where(sql`${table.roleId} is not null`),
    uniqueIndex("tna_exercise_targets_exercise_user_unique")
      .on(table.tnaExerciseId, table.userId)
      .where(sql`${table.userId} is not null`),
    check("tna_exercise_targets_type_check", sql`${table.targetType} in ('department', 'role', 'user')`),
    check(
      "tna_exercise_targets_shape_check",
      sql`(${table.targetType} = 'department' and ${table.departmentId} is not null and ${table.roleId} is null and ${table.userId} is null)
        or (${table.targetType} = 'role' and ${table.roleId} is not null and ${table.departmentId} is null and ${table.userId} is null)
        or (${table.targetType} = 'user' and ${table.userId} is not null and ${table.departmentId} is null and ${table.roleId} is null)`,
    ),
  ],
);
