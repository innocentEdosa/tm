import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { superAdmins } from "./super-admins";

/**
 * Global, platform-level key/value settings — no `tenant_id`, no RLS, same posture as
 * `tenant_config_action_log` (platform data, Super-Admin-route-only writes). Shaped as key/value
 * rather than one column per setting so future platform-wide settings (UI Theme Switching's
 * `active_theme` is the first) don't each need their own column + migration.
 */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBySuperAdminId: uuid("updated_by_super_admin_id").references(() => superAdmins.id, {
    onDelete: "set null",
  }),
});
