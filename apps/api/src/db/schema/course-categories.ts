import { pgTable, uuid, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/** Platform-global default course-category catalog (data-model.md `course_category_templates`),
 * mirrors `department_templates`'s shape — the seeded default set every tenant's `course_categories`
 * starts from (spec Clarifications, research.md §1). */
export const courseCategoryTemplates = pgTable("course_category_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A tenant-owned, tenant-extensible course category (data-model.md `course_categories`). Seeded from
 * `course_category_templates` at provisioning (spec FR-001a); a `course.manage` holder can add further
 * rows inline via course create/update (FR-001b, research.md §3/§4) — there is no dedicated write
 * endpoint for this table.
 */
export const courseCategories = pgTable(
  "course_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    sourceTemplateId: uuid("source_template_id").references(() => courseCategoryTemplates.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive per-tenant uniqueness (spec Key Entities/Edge Cases) — same technique as
    // departments_tenant_id_name_unique, and the conflict target `resolveOrCreateCourseCategory`
    // (course-category-resolution.ts) upserts against.
    uniqueIndex("course_categories_tenant_id_name_unique").on(table.tenantId, sql`lower(${table.name})`),
  ],
);
