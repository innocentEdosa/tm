import { pgTable, uuid, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { permissions } from "./permissions";

export const roleTemplates = pgTable("role_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isPlatformOnly: boolean("is_platform_only").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roleTemplatePermissions = pgTable(
  "role_template_permissions",
  {
    roleTemplateId: uuid("role_template_id")
      .notNull()
      .references(() => roleTemplates.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleTemplateId, table.permissionId] })],
);
