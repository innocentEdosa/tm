import { pgTable, uuid, text, bigint, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A tenant-scoped, polymorphic file attachment (data-model.md `file_attachments`). `entityId` has no
 * database-level FK — deliberately polymorphic, mirrors `custom_field_values.entity_id`
 * (research.md §3). `entityType`'s CHECK is extended by a future migration when a second entity type
 * is wired, mirroring `content_items.type`'s own extensible-enum convention. `course` (course image)
 * and `course_author` (author profile image) were added alongside the course-authoring wiring pass.
 *
 * `kind` distinguishes a real uploaded file (`storageKey`/`contentType`/`sizeBytes` populated, `url`
 * null) from a plain external link (`url` populated, storage columns null) — a lesson resource can be
 * either, and reusing one table/route surface for both avoids a second near-identical entity just for
 * links, which never touch R2 at all and are `status:'ready'` immediately on creation.
 *
 * `storage_key` was unique until spec 029 (Course Marketplace) dropped that constraint
 * (`0102_drop_file_attachments_storage_key_unique.sql`) — a cloned tenant content item's attachment
 * row legitimately shares its `storage_key` with the platform original's `platform_file_attachments`
 * row, never re-uploading the underlying R2 object (spec 029 research.md §1).
 */
export const fileAttachments = pgTable(
  "file_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    kind: text("kind").notNull().default("file"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key"),
    url: text("url"),
    status: text("status").notNull().default("pending"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("file_attachments_tenant_id_entity_type_entity_id_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
    ),
    check("file_attachments_entity_type_check", sql`${table.entityType} in ('content_item', 'course', 'course_author')`),
    check("file_attachments_kind_check", sql`${table.kind} in ('file', 'link')`),
    check("file_attachments_status_check", sql`${table.status} in ('pending', 'ready')`),
    check(
      "file_attachments_kind_shape_check",
      sql`(${table.kind} = 'file' and ${table.storageKey} is not null and ${table.contentType} is not null and ${table.sizeBytes} is not null and ${table.url} is null)
        or (${table.kind} = 'link' and ${table.url} is not null and ${table.storageKey} is null and ${table.contentType} is null and ${table.sizeBytes} is null)`,
    ),
  ],
);
