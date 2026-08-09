import { pgTable, uuid, text, timestamp, date, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { courses } from "./courses";
import { users } from "./users";
import { departments } from "./departments";
import { roles } from "./roles";

export const ASSIGNEE_TYPES = ["all", "user", "department", "role"] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

/**
 * Who a course is assigned to (Course Assignment Settings) — one row per target. `assignee_type =
 * 'all'` means "everyone in the tenant" and is mutually exclusive with every other row for the same
 * course (enforced by the app layer's replace-all save, not by a DB trigger). A course with zero
 * rows here is treated identically to an explicit `'all'` row (see the courses routes' visibility
 * query) — this keeps every course created before this feature, and every brand-new course before
 * its Settings tab is ever touched, visible to the whole tenant by default (backward compatible).
 * `courseId` cascades: assignment rows are meaningless once their course is gone, unlike
 * `course_modules`/`content_items`, which the course routes clean up explicitly because that FK is
 * `restrict`.
 *
 * `startsAt`/`completionDeadline` (Course Assignment Deadlines, and its Audience Builder follow-up)
 * both belong to the *assignment row*, never the course itself — a course has no single date of its
 * own; each assignment path to it can carry its own pair. Two distinct, independent concepts: `starts_at`
 * is when access to the course *begins* for whoever's reached through this row (`null` = immediately);
 * `completion_deadline` is when the course is *due* for them (`null` = no due date). Originally a single
 * `deadline` column meant only "starts at" — renamed to `starts_at` (migration `0108`) once
 * `completion_deadline` was added alongside it, so two genuinely different dates never share one
 * ambiguous name. For `'all'`/`'department'`/`'role'` these are shared by everyone reached through
 * that row; for `'user'` this table already has exactly one row per individually-assigned user, so the
 * same two columns double as that user's own dates with no extra table needed. Both nullable: optional
 * (an assignment doesn't require either), and every row from before either column existed reads as
 * `null` — no backfill needed. Plain `date` (day-only, no time/timezone component) rather than
 * `timestamp with time zone` (unlike every other timestamp in this schema) — a date like "September
 * 30" names a calendar day, not an instant; storing it as a timestamptz risks the classic
 * off-by-one-day display bug in a negative-UTC-offset browser. Precedence when a caller is reachable
 * through more than one assignment row at once (e.g. their department *and* their role) is resolved
 * at read time by `resolveDeadlinesForCaller` (tenant-course-routes.ts) — the earliest non-null value
 * among every row that applies to them wins, for each column independently, never a "most specific
 * type" rule.
 */
export const courseAssignments = pgTable(
  "course_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => courses.id, { onDelete: "cascade" }),
    assigneeType: text("assignee_type").notNull(),
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references((): AnyPgColumn => roles.id, { onDelete: "cascade" }),
    // Physical column name is still literally `deadline` (unchanged since the original migration) —
    // only the Drizzle-ORM-level TS property is renamed to `startsAt`. Keeps this a pure additive
    // migration (just `ADD COLUMN completion_deadline`) instead of a real `RENAME COLUMN`, which
    // `drizzle-kit generate` can only resolve via an interactive prompt this non-interactive
    // environment can't answer.
    startsAt: date("deadline"),
    completionDeadline: date("completion_deadline"),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("course_assignments_tenant_id_course_id_idx").on(table.tenantId, table.courseId),
    index("course_assignments_tenant_id_user_id_idx").on(table.tenantId, table.userId),
    index("course_assignments_tenant_id_department_id_idx").on(table.tenantId, table.departmentId),
    index("course_assignments_tenant_id_role_id_idx").on(table.tenantId, table.roleId),
    // Partial-unique guards, mirroring `roles_single_platform_role_idx`'s idiom — at most one 'all'
    // row per course, and at most one row per (course, specific target).
    uniqueIndex("course_assignments_course_all_unique")
      .on(table.courseId)
      .where(sql`${table.assigneeType} = 'all'`),
    uniqueIndex("course_assignments_course_user_unique")
      .on(table.courseId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("course_assignments_course_department_unique")
      .on(table.courseId, table.departmentId)
      .where(sql`${table.departmentId} is not null`),
    uniqueIndex("course_assignments_course_role_unique")
      .on(table.courseId, table.roleId)
      .where(sql`${table.roleId} is not null`),
    check("course_assignments_assignee_type_check", sql`${table.assigneeType} in ('all', 'user', 'department', 'role')`),
    // Exactly one of userId/departmentId/roleId is set, and only for the matching assigneeType —
    // mirrors the shape of the assignee_type check itself rather than relying on the app layer alone.
    check(
      "course_assignments_target_shape_check",
      sql`(${table.assigneeType} = 'all' and ${table.userId} is null and ${table.departmentId} is null and ${table.roleId} is null)
        or (${table.assigneeType} = 'user' and ${table.userId} is not null and ${table.departmentId} is null and ${table.roleId} is null)
        or (${table.assigneeType} = 'department' and ${table.departmentId} is not null and ${table.userId} is null and ${table.roleId} is null)
        or (${table.assigneeType} = 'role' and ${table.roleId} is not null and ${table.userId} is null and ${table.departmentId} is null)`,
    ),
  ],
);
