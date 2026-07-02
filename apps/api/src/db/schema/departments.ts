import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/** Platform-global default department catalog (data-model.md `department_templates`), mirrors
 * `role_templates`'s shape minus a permissions join table — departments don't carry permissions. */
export const departmentTemplates = pgTable("department_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A tenant-owned unit of org structure (data-model.md `departments`). Seeded from
 * `department_templates` at provisioning time, then freely renamable/addable/removable. */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("departments_tenant_id_name_unique").on(table.tenantId, table.name)],
);
