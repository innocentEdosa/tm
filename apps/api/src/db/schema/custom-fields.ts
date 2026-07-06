import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";

/**
 * Platform-global catalog of developer-registered form types (data-model.md `form_definitions`).
 * No `tenant_id` — never runtime-writable by anyone, Super Admin or tenant (spec FR-001/FR-013);
 * seeded once via migration (`department`). Mirrors `permissions`/`department_templates`'s
 * SELECT-only-to-tm_app grant treatment.
 */
export const formDefinitions = pgTable("form_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A single field attached to a form type (data-model.md `form_fields`) — either a Super-Admin
 * global default (`tenantId IS NULL`) or one tenant's own addition. This table's RLS policy is this
 * codebase's first *dual-visibility* shape (research.md §1): readable by every tenant when global or
 * own, writable only when own (or by a Super Admin session, for the not-yet-built authoring screen,
 * spec FR-002). The literal `(tenantId, formDefinitionId, fieldKey)` unique index below does not by
 * itself catch a cross-scope collision (a tenant field vs. an existing global field) — Postgres
 * treats a NULL `tenantId` as a different value, not something that conflicts with a real tenant
 * UUID — closed at the application layer instead (research.md §2,
 * `apps/api/src/custom-fields/field-key-uniqueness.ts`).
 */
export const formFields = pgTable(
  "form_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formDefinitionId: uuid("form_definition_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "restrict" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    options: jsonb("options"),
    isRequired: boolean("is_required").notNull().default(false),
    displayOrder: integer("display_order").notNull(),
    createdBy: text("created_by").notNull(),
    /** Marks a placeholder row for one of a form's fixed, module-hardcoded fields (e.g.
     * Department's Name/Description) — seeded once per form type (`tenant_id IS NULL`), never
     * editable/archivable by anyone at runtime. Exists purely so a system field has the same stable
     * `id` every other field has, letting it participate in one unified, tenant-overridable
     * `display_order` alongside global/tenant custom fields (`form_field_order_overrides`) — its
     * own `fieldType`/`options`/`isRequired` are nominal labels only, never used for rendering or
     * validation; the consuming module always renders its own real, hardcoded control for these,
     * matched by `fieldKey`. */
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("form_fields_tenant_id_form_definition_id_field_key_unique").on(
      table.tenantId,
      table.formDefinitionId,
      table.fieldKey,
    ),
    check(
      "form_fields_field_type_check",
      sql`${table.fieldType} IN ('text', 'textarea', 'number', 'date', 'select', 'multiselect')`,
    ),
    check(
      "form_fields_created_by_check",
      sql`${table.createdBy} IN ('super_admin', 'tenant_admin', 'system')`,
    ),
  ],
);

/**
 * A tenant's override of one field's position in a form's unified layout (system + global + tenant
 * fields all reordered together, as one flat sequence, per direct product feedback — superseding
 * this framework's original "tenant fields can only reorder among themselves" restriction).
 * `fieldId` can point at a system, global, or tenant-owned `form_fields` row; only the *position* is
 * ever overridden here — a system/global row's label/type/required stays exactly as seeded/set by
 * its owner, never editable by a tenant. One row per (tenant, field); absence means "use that
 * field's own seeded/default `display_order`."
 */
export const formFieldOrderOverrides = pgTable(
  "form_field_order_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    formDefinitionId: uuid("form_definition_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "restrict" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => formFields.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("form_field_order_overrides_tenant_id_field_id_unique").on(table.tenantId, table.fieldId),
  ],
);

/**
 * One entity's stored answer for one field (data-model.md `custom_field_values`). `entityId` has no
 * DB-level FK — polymorphic across entity tables by design (spec's own data model); the calling
 * module (e.g. Department's routes) is responsible for having already confirmed, via its own
 * tenant-scoped fetch, that this id refers to a real entity in the caller's own tenant before saving
 * a value against it.
 */
export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    formDefinitionId: uuid("form_definition_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "restrict" }),
    entityId: uuid("entity_id").notNull(),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => formFields.id, { onDelete: "restrict" }),
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("custom_field_values_tenant_id_entity_id_field_id_unique").on(
      table.tenantId,
      table.entityId,
      table.fieldId,
    ),
  ],
);
