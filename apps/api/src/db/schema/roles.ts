import { pgTable, uuid, text, timestamp, primaryKey, uniqueIndex, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { permissions } from "./permissions";
import { roleTemplates } from "./role-templates";

/**
 * `tenant_id IS NULL` is reserved for exactly one row: the platform-level Super Admin role.
 * Postgres unique indexes treat NULL as distinct-from-NULL, so uniqueness on `tenant_id` itself
 * would not block a second NULL row — hence the partial unique index on a constant expression,
 * scoped to the `tenant_id IS NULL` rows only (data-model.md `roles`).
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    name: text("name").notNull(),
    description: text("description"),
    sourceTemplateId: uuid("source_template_id").references(() => roleTemplates.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("roles_single_platform_role_idx").on(sql`(1)`).where(sql`tenant_id IS NULL`),
    unique("roles_tenant_id_name_unique").on(table.tenantId, table.name),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("user_roles_user_id_role_id_unique").on(table.userId, table.roleId)],
);
