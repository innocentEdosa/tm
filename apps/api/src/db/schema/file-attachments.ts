import { pgTable, uuid, text, bigint, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
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
    /** AI Image Discovery & Course Asset Management Phase 1 — nullable, additive (0124 migration).
     * NULL for every attachment created before this phase and for every manually-uploaded/linked
     * attachment going forward; only ever populated when `set_course_image`/`set_lesson_image`
     * persists an AI-discovered image, since that's the one case this app has actual, real
     * attribution/licensing data worth keeping (a provider's photographer name/link, source page,
     * license) that no existing column could hold. Shape (all optional — a provider may not supply
     * every field): `{ provider, providerImageId, authorName, authorUrl, sourceUrl, license,
     * licenseUrl }`. Never used for authorization or resolution — purely display data, read by
     * `ProposalCard` and the course/lesson image UI to render attribution where available. */
    metadata: jsonb("metadata"),
    status: text("status").notNull().default("pending"),
    /** Video Lesson Upload — set only while a multipart upload session (large video) is in progress;
     * NULL for every single-PUT attachment (the vast majority) and cleared back to NULL once
     * `completeMultipartUpload`/`abortMultipartUpload` runs. This is the only extra state a
     * multipart upload needs beyond what already exists here — R2 itself tracks which parts have
     * been received for a given `uploadId`, so there's nothing else to persist (no per-part table,
     * no separate "expected size" column: `size_bytes` already serves that role, verified against the
     * real assembled object via `headObject` exactly like the existing single-PUT confirm flow). */
    multipartUploadId: text("multipart_upload_id"),
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
