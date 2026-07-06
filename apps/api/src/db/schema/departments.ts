import { pgTable, uuid, text, timestamp, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/** Platform-global default department catalog (data-model.md `department_templates`), mirrors
 * `role_templates`'s shape minus a permissions join table — departments don't carry permissions. */
export const departmentTemplates = pgTable("department_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A tenant-owned unit of org structure (data-model.md `departments`). Seeded flat from
 * `department_templates` at provisioning time (Spec 002); this spec (009) adds hierarchy
 * (`parentDepartmentId`, self-referencing, capped at 3 levels — enforced in
 * `apps/api/src/departments/department-hierarchy.ts`, not here), lifecycle (`status`), and
 * Manager/Assistant Manager. `departments` and `users` are mutually referencing
 * (`users.departmentId` → here; `managerId`/`assistantManagerId` → there) — safe under Drizzle's
 * lazy `.references(() => ...)` callback (research.md §9), which only resolves once both modules
 * have finished loading.
 */
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    sourceTemplateId: uuid("source_template_id").references(() => departmentTemplates.id, {
      onDelete: "set null",
    }),
    parentDepartmentId: uuid("parent_department_id").references((): AnyPgColumn => departments.id, {
      onDelete: "restrict",
    }),
    description: text("description"),
    status: text("status").notNull().default("active"),
    managerId: uuid("manager_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    assistantManagerId: uuid("assistant_manager_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive per-tenant uniqueness (spec FR-004) — replaces the plain
    // `departments_tenant_id_name_unique` constraint from 0008_init_tenant_provisioning.sql, which
    // did not account for case.
    uniqueIndex("departments_tenant_id_name_unique").on(table.tenantId, sql`lower(${table.name})`),
    check("departments_status_check", sql`${table.status} in ('active', 'archived')`),
  ],
);
