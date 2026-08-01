import { pgTable, uuid, text, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { courses } from "./courses";
import { users } from "./users";

/**
 * A tenant-scoped author/instructor credited on a course (data-model addition for the course-editor
 * "Course Authors" panel). Profile image lives in `file_attachments` (`entityType: 'course_author'`,
 * `entityId` = this row's id), same polymorphic pattern as everything else in that table.
 */
export const courseAuthors = pgTable(
  "course_authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    roleOrDescription: text("role_or_description"),
    addedByUserId: uuid("added_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("course_authors_tenant_id_course_id_idx").on(table.tenantId, table.courseId)],
);
