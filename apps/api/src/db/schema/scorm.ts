import { pgTable, uuid, text, integer, numeric, jsonb, timestamp, index, unique, type AnyPgColumn } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { contentItems } from "./course-content";

/**
 * One row per imported SCORM package (data-model.md `scorm_packages`). Groups together every content
 * item auto-created from its manifest (one per SCO) via `scorm_package_items` — one-to-many, not
 * one-to-one with a single content item (research.md §8).
 */
export const scormPackages = pgTable("scorm_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  title: text("title"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per SCO within a package (data-model.md `scorm_package_items`). Unlike
 * `file_attachments`/`learner_content_progress`'s deliberately loose coupling to `content_items`, this
 * uses a real FK with `ON DELETE CASCADE` — rows here are created in the same transaction as their
 * content item, by this spec's own import logic, not an independently-lifecycled relationship
 * (research.md §8). `position` is package-scoped (distinct from `content_items.position`, which is
 * module-wide and may include non-package siblings) and backs previous/next navigation (FR-013).
 */
export const scormPackageItems = pgTable(
  "scorm_package_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    packageId: uuid("package_id")
      .notNull()
      .references((): AnyPgColumn => scormPackages.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id")
      .notNull()
      .unique()
      .references((): AnyPgColumn => contentItems.id, { onDelete: "cascade" }),
    manifestItemIdentifier: text("manifest_item_identifier").notNull(),
    entryPointRelativePath: text("entry_point_relative_path").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    unique("scorm_package_items_package_id_position_unique").on(table.packageId, table.position),
    index("scorm_package_items_tenant_id_package_id_idx").on(table.tenantId, table.packageId),
  ],
);

/**
 * `cmi.objectives.n.*` per learner per SCO (data-model.md `scorm_cmi_objectives`). `contentItemId` has
 * **no FK** — mirrors `learner_content_progress.contentItemId`'s loose coupling (research.md §8); this
 * row's lifecycle should follow the learner's progress record, not the content item directly. Fields are
 * not `CHECK`-constrained (research.md §9) — SCORM conformance cares about round-trip accuracy, not this
 * LMS re-validating every SCORM-defined sub-vocabulary.
 */
export const scormCmiObjectives = pgTable(
  "scorm_cmi_objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    contentItemId: uuid("content_item_id").notNull(),
    objectiveIndex: integer("objective_index").notNull(),
    objectiveId: text("objective_id"),
    status: text("status"),
    scoreRaw: numeric("score_raw", { precision: 12, scale: 4, mode: "number" }),
    scoreMin: numeric("score_min", { precision: 12, scale: 4, mode: "number" }),
    scoreMax: numeric("score_max", { precision: 12, scale: 4, mode: "number" }),
  },
  (table) => [
    unique("scorm_cmi_objectives_tenant_user_content_item_index_unique").on(
      table.tenantId,
      table.userId,
      table.contentItemId,
      table.objectiveIndex,
    ),
  ],
);

/**
 * `cmi.interactions.n.*` per learner per SCO (data-model.md `scorm_cmi_interactions`). Same loose
 * `contentItemId` coupling and unconstrained-sub-field rationale as `scormCmiObjectives` above.
 */
export const scormCmiInteractions = pgTable(
  "scorm_cmi_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    contentItemId: uuid("content_item_id").notNull(),
    interactionIndex: integer("interaction_index").notNull(),
    interactionId: text("interaction_id"),
    type: text("type"),
    weighting: numeric("weighting", { precision: 12, scale: 4, mode: "number" }),
    studentResponse: text("student_response"),
    result: text("result"),
    latency: text("latency"),
    correctResponses: jsonb("correct_responses"),
  },
  (table) => [
    unique("scorm_cmi_interactions_tenant_user_content_item_index_unique").on(
      table.tenantId,
      table.userId,
      table.contentItemId,
      table.interactionIndex,
    ),
  ],
);
