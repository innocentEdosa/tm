import { pgTable, uuid, text, timestamp, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
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
