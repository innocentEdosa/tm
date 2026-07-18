import { pgTable, uuid, text, integer, jsonb, timestamp, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { courses } from "./courses";
import { users } from "./users";

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
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("course_modules_tenant_id_course_id_idx").on(table.tenantId, table.courseId)],
);

/**
 * A tenant-scoped, ordered, polymorphic unit of curriculum content within exactly one module
 * (data-model.md `content_items`). `courseId` is denormalized from the owning module at creation and
 * never changes (research.md §1 — FR-008 only allows moving between modules of the *same* course).
 * `type` is immutable once set (enforced in the route handler, not the database) and determines the
 * required shape of `payload` (research.md §3, validated in `content-item-payload-validation.ts`).
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
    moduleId: uuid("module_id")
      .notNull()
      .references((): AnyPgColumn => courseModules.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    payload: jsonb("payload").notNull().default({}),
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
    check(
      "content_items_type_check",
      sql`${table.type} in ('video', 'article', 'live_class', 'test', 'assignment', 'external_import')`,
    ),
  ],
);
