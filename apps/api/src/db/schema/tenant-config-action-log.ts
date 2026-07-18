import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { superAdmins } from "./super-admins";

/**
 * Append-only record of a Super Admin Tenant Console action targeting a role, department, or custom
 * field definition (data-model.md; Super Admin Edit Tenant Configuration spec Clarifications). Kept
 * as its own table rather than reusing `member_action_log` — that table is shaped specifically
 * around a member (`memberId`), and a role/department/field edit doesn't target one, the same
 * reasoning `member_action_log`'s own doc comment already gives for not merging into
 * `tenant_action_log`. Same platform-level, no-RLS, Super-Admin-route-only-access posture as
 * `member_action_log`. `tm_app` is granted `INSERT`/`SELECT` only, no `UPDATE`/`DELETE`
 * (migration 0066) — append-only.
 *
 * `tenantId` and `superAdminId` are nullable with `onDelete: "set null"`, mirroring
 * `member_action_log`'s own treatment: the audit trail must survive a later, unrelated deletion of
 * the tenant or the Super Admin account, never being blocked by or cascade-deleted alongside either.
 * `entityId` carries no FK — polymorphic across `roles`/`departments`/`form_fields` by design, same
 * reasoning `custom_field_values.entity_id` already uses.
 */
export const tenantConfigActionLog = pgTable(
  "tenant_config_action_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    superAdminId: uuid("super_admin_id").references(() => superAdmins.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "tenant_config_action_log_entity_type_check",
      sql`${table.entityType} in ('role', 'department', 'custom_field')`,
    ),
  ],
);
