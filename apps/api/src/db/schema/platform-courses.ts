import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  jsonb,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { superAdmins } from "./super-admins";
import { users } from "./users";
import { courses } from "./courses";

/**
 * A platform-level (no `tenant_id`) course-catalog entry authored by Super Admin (data-model.md
 * `platform_courses`). No RLS — protection is entirely `requireSuperAdminSession` at the route layer,
 * the same class as `permissions`/`role_templates`/`course_category_templates` (Constitution Check,
 * spec 029 plan.md). `category_name` is a plain name, not an FK, since there is no tenant to own a
 * `course_categories` row — resolved into the *cloning* tenant's own category list at clone time
 * (research.md §5). Becomes content-immutable once any tenant has a `fulfilled`
 * `marketplace_selections` row referencing it (enforced in `platform-course-immutability.ts`, not a
 * DB constraint).
 */
export const platformCourses = pgTable(
  "platform_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    categoryName: text("category_name").notNull(),
    deliveryMode: text("delivery_mode").notNull(),
    durationValue: numeric("duration_value", { precision: 6, scale: 2, mode: "number" }).notNull(),
    durationUnit: text("duration_unit").notNull(),
    provider: text("provider"),
    cost: numeric("cost", { precision: 12, scale: 2, mode: "number" }),
    status: text("status").notNull().default("draft"),
    // Mirrors tenant courses.ts's own learningObjectives/requirements exactly (same shape, same
    // default) — added here so the tenant course editor's Course Objectives panel can be reused
    // unmodified for platform-course authoring (spec 029 UI-reuse follow-up).
    learningObjectives: text("learning_objectives").array().notNull().default([]),
    requirements: text("requirements").array().notNull().default([]),
    createdBySuperAdminId: uuid("created_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    updatedBySuperAdminId: uuid("updated_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_courses_status_idx").on(table.status),
    index("platform_courses_category_name_idx").on(table.categoryName),
    check(
      "platform_courses_delivery_mode_check",
      sql`${table.deliveryMode} in ('in_person', 'virtual', 'self_paced', 'blended')`,
    ),
    check("platform_courses_duration_unit_check", sql`${table.durationUnit} in ('minutes', 'hours', 'days')`),
    check("platform_courses_status_check", sql`${table.status} in ('draft', 'active', 'archived')`),
    check("platform_courses_duration_value_positive_check", sql`${table.durationValue} > 0`),
    check("platform_courses_cost_non_negative_check", sql`${table.cost} is null or ${table.cost} >= 0`),
  ],
);

/** A platform-level, ordered section within exactly one Platform Course (data-model.md
 * `platform_course_modules`). Same shape as `course_modules` minus `tenant_id`. */
export const platformCourseModules = pgTable(
  "platform_course_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformCourseId: uuid("platform_course_id")
      .notNull()
      .references((): AnyPgColumn => platformCourses.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    createdBySuperAdminId: uuid("created_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    updatedBySuperAdminId: uuid("updated_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("platform_course_modules_platform_course_id_idx").on(table.platformCourseId)],
);

/** A platform-level, ordered, polymorphic unit of curriculum content within exactly one Platform
 * Course Module (data-model.md `platform_course_content_items`). Same six-type shape as
 * `content_items` minus `tenant_id`, validated by the same `validateContentItemPayload`. */
export const platformCourseContentItems = pgTable(
  "platform_course_content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformCourseId: uuid("platform_course_id")
      .notNull()
      .references((): AnyPgColumn => platformCourses.id, { onDelete: "restrict" }),
    platformCourseModuleId: uuid("platform_course_module_id")
      .notNull()
      .references((): AnyPgColumn => platformCourseModules.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdBySuperAdminId: uuid("created_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    updatedBySuperAdminId: uuid("updated_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_course_content_items_platform_course_id_idx").on(table.platformCourseId),
    index("platform_course_content_items_module_id_idx").on(table.platformCourseModuleId),
    check(
      "platform_course_content_items_type_check",
      sql`${table.type} in ('video', 'article', 'live_class', 'test', 'assignment', 'external_import')`,
    ),
  ],
);

/** A platform-level file attachment on a Platform Course Content Item (data-model.md
 * `platform_file_attachments`). Same shape as `file_attachments` minus `tenant_id` — kept as its own
 * table rather than a nullable-`tenant_id` reuse of `file_attachments` (research.md §2). `storage_key`
 * is unique here (safe — nothing clones *into* this table, only tenant `file_attachments` rows clone
 * *out of* it, referencing the same key). */
export const platformFileAttachments = pgTable(
  "platform_file_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status").notNull().default("pending"),
    createdBySuperAdminId: uuid("created_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_file_attachments_entity_type_entity_id_idx").on(table.entityType, table.entityId),
    uniqueIndex("platform_file_attachments_storage_key_unique").on(table.storageKey),
    check("platform_file_attachments_entity_type_check", sql`${table.entityType} in ('platform_content_item')`),
    check("platform_file_attachments_status_check", sql`${table.status} in ('pending', 'ready')`),
  ],
);

/** Tracks one tenant's relationship to one platform course (data-model.md `marketplace_selections`).
 * `tenant_id` NOT NULL, RLS `tenant_isolation` + `super_admin_full_access` (research.md §3) — the
 * tenant's own reads/writes go through `request.tenantDb`, the Super Admin cross-tenant queue read
 * goes through `request.superAdminDb`. At most one non-`rejected` row per (tenant, platform course)
 * pair, enforced by the partial unique index below, not application logic alone (FR-009). */
export const marketplaceSelections = pgTable(
  "marketplace_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    platformCourseId: uuid("platform_course_id")
      .notNull()
      .references((): AnyPgColumn => platformCourses.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("requested"),
    clonedCourseId: uuid("cloned_course_id").references((): AnyPgColumn => courses.id, { onDelete: "set null" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedBySuperAdminId: uuid("resolved_by_super_admin_id").references(() => superAdmins.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("marketplace_selections_tenant_id_idx").on(table.tenantId),
    index("marketplace_selections_status_idx").on(table.status),
    uniqueIndex("marketplace_selections_tenant_platform_course_active_unique")
      .on(table.tenantId, table.platformCourseId)
      .where(sql`${table.status} != 'rejected'`),
    check(
      "marketplace_selections_status_check",
      sql`${table.status} in ('requested', 'paid', 'rejected', 'fulfilled')`,
    ),
  ],
);
