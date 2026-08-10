import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { formDefinitions } from "./custom-fields";
import { superAdmins } from "./super-admins";
import { tenants } from "./tenants";

/**
 * One buildable/publishable snapshot of a form type's steps/sections/fields/layout
 * (data-model.md `form_versions`). Exactly one version per `form_definition_id` is ever
 * `published` at a time — enforced in the publish route transaction, not a DB constraint, since
 * "at most one published row per form type" isn't expressible as a plain `CHECK`.
 */
export const formVersions = pgTable(
  "form_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formDefinitionId: uuid("form_definition_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    layoutConfig: jsonb("layout_config"),
    createdBySuperAdminId: uuid("created_by_super_admin_id").references(() => superAdmins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("form_versions_form_definition_id_version_number_unique").on(
      table.formDefinitionId,
      table.versionNumber,
    ),
    check(
      "form_versions_status_check",
      sql`${table.status} IN ('draft', 'published', 'archived')`,
    ),
  ],
);

/**
 * An ordered, optionally-skippable wizard stage — either the platform version's own (data-model.md
 * `form_steps`, spec FR-017; `formVersionId` set, `tenantId` null) or a Tenant Admin's own step
 * that only ever renders for their own tenant (`formVersionId` null, `tenantId` set) — the exact
 * same dual-ownership shape `form_fields` already uses for system/platform vs. tenant rows,
 * extended from field level to structural level (Form Builder spec follow-up: "the tenant can
 * have sections and steps too, it just only affects their tenant"). `formDefinitionId` is a
 * direct column (not derived through `formVersionId`, which a tenant-owned row never has) so
 * every row can always be resolved to "which form type" without an optional join. `key` is
 * stable per (version | tenant+form) and used for cross-version reconciliation of tenant
 * customizations on republish (spec FR-025) — a tenant-owned step never needs that reconciliation
 * in the first place, since it was never tied to any platform version to begin with.
 */
export const formSteps = pgTable(
  "form_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formDefinitionId: uuid("form_definition_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "cascade" }),
    formVersionId: uuid("form_version_id").references(() => formVersions.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    displayOrder: integer("display_order").notNull(),
    isOptional: boolean("is_optional").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("form_steps_form_version_id_key_unique").on(table.formVersionId, table.key),
    unique("form_steps_form_version_id_display_order_unique").on(
      table.formVersionId,
      table.displayOrder,
    ),
    unique("form_steps_tenant_id_form_definition_id_key_unique").on(table.tenantId, table.formDefinitionId, table.key),
    check(
      "form_steps_ownership_check",
      sql`(${table.formVersionId} IS NOT NULL AND ${table.tenantId} IS NULL) OR (${table.formVersionId} IS NULL AND ${table.tenantId} IS NOT NULL)`,
    ),
  ],
);

/**
 * A named, ordered group of fields — same platform-vs-tenant dual ownership as `formSteps` above
 * (data-model.md `form_sections`, spec FR-018), optionally within a step. `formStepId` accepts
 * either a platform or a tenant step's id — application logic (not a DB constraint) keeps a
 * tenant-owned section from ever nesting under a platform step, so a tenant's own structure never
 * depends on something only a Super Admin can change or remove.
 */
export const formSections = pgTable(
  "form_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formDefinitionId: uuid("form_definition_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "cascade" }),
    formVersionId: uuid("form_version_id").references(() => formVersions.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    formStepId: uuid("form_step_id").references(() => formSteps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("form_sections_form_version_id_key_unique").on(table.formVersionId, table.key),
    unique("form_sections_tenant_id_form_definition_id_key_unique").on(table.tenantId, table.formDefinitionId, table.key),
    check(
      "form_sections_ownership_check",
      sql`(${table.formVersionId} IS NOT NULL AND ${table.tenantId} IS NULL) OR (${table.formVersionId} IS NULL AND ${table.tenantId} IS NOT NULL)`,
    ),
  ],
);

/**
 * A tenant's own submit-button text/position for a form type (Form Builder spec follow-up —
 * "platform admins / admins should be able to change... even if they can't change labels",
 * extended to the CTA button: a Tenant Admin gets their own override, never touching the
 * platform version's own `form_versions.layout_config.cta`). `cta` mirrors that same shape
 * (`{ label?, align? }`) — resolved with the tenant override taking precedence in
 * `getEffectiveForm`, the platform's own CTA as the fallback.
 */
export const tenantFormCtaOverrides = pgTable(
  "tenant_form_cta_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    formDefinitionId: uuid("form_definition_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "cascade" }),
    cta: jsonb("cta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("tenant_form_cta_overrides_tenant_id_form_definition_id_unique").on(table.tenantId, table.formDefinitionId)],
);
