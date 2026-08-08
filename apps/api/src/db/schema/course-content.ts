import { pgTable, uuid, text, integer, jsonb, timestamp, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { courses } from "./courses";
import { users } from "./users";
import { platformCourseModules, platformCourseContentItems } from "./platform-courses";

/**
 * A tenant-scoped, ordered section within exactly one course (data-model.md `course_modules`).
 * `position` is server-computed only — append-on-create, full-rewrite-on-reorder (research.md §4);
 * never accepted as client input. Deleting a module cascades to delete its content items (see
 * `contentItems.moduleId`, research.md §5).
 */
export const courseModules = pgTable(
  "course_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => courses.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    /** Independent of the parent course's own draft/active/archived status — a module can be
     * draft/published while its course is still active, matching the course-editor UI's per-module
     * publish toggle. */
    status: text("status").notNull().default("draft"),
    // Course Marketplace Updates (spec 032) — set at clone time and re-set on every "apply update"
    // for a module that originated from a platform course; NULL for a tenant-authored module. Lets
    // applyPlatformCourseUpdateToTenant match this row to its platform counterpart across edits
    // (research.md §4) instead of matching by title/position, which can both change.
    sourcePlatformCourseModuleId: uuid("source_platform_course_module_id").references(
      (): AnyPgColumn => platformCourseModules.id,
      { onDelete: "set null" },
    ),
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
    index("course_modules_tenant_id_course_id_idx").on(table.tenantId, table.courseId),
    index("course_modules_source_platform_course_module_id_idx").on(table.sourcePlatformCourseModuleId),
    check("course_modules_status_check", sql`${table.status} in ('draft', 'published')`),
  ],
);

/**
 * A tenant-scoped, ordered, polymorphic unit of curriculum content within at most one module
 * (data-model.md `content_items`). `courseId` is denormalized from the owning module at creation and
 * never changes (research.md §1 — FR-008 only allows moving between modules of the *same* course).
 * `type` is immutable once set (enforced in the route handler, not the database) and determines the
 * required shape of `payload` (research.md §3, validated in `content-item-payload-validation.ts`).
 * `moduleId` is nullable — a standalone (module-less) lesson lives directly at the course's top
 * level, ordered via `courses.outlineOrder` rather than a module's own `position` sequence.
 */
export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => courses.id, { onDelete: "restrict" }),
    moduleId: uuid("module_id").references((): AnyPgColumn => courseModules.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    payload: jsonb("payload").notNull().default({}),
    /** Independent of the parent course's own status — a lesson can be draft/published while its
     * course is active, matching the course-editor UI's per-lesson publish toggle. */
    status: text("status").notNull().default("draft"),
    // Course Marketplace Updates (spec 032) — same purpose as course_modules'
    // sourcePlatformCourseModuleId above, one level down. This is the column that makes "keep
    // progress, update content" possible: learner_content_progress.content_item_id has no FK by
    // design (learner-content-progress.ts), so as long as a content item that persists across a
    // platform edit keeps this same tenant-side row id, existing progress rows keep resolving with
    // zero extra work (research.md §4).
    sourcePlatformCourseContentItemId: uuid("source_platform_course_content_item_id").references(
      (): AnyPgColumn => platformCourseContentItems.id,
      { onDelete: "set null" },
    ),
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
    index("content_items_tenant_id_course_id_idx").on(table.tenantId, table.courseId),
    index("content_items_tenant_id_module_id_idx").on(table.tenantId, table.moduleId),
    index("content_items_source_platform_course_content_item_id_idx").on(table.sourcePlatformCourseContentItemId),
    check(
      "content_items_type_check",
      sql`${table.type} in ('video', 'article', 'live_class', 'test', 'assignment', 'external_import')`,
    ),
    check("content_items_status_check", sql`${table.status} in ('draft', 'published')`),
  ],
);
