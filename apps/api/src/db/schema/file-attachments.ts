import { pgTable, uuid, text, bigint, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A tenant-scoped, polymorphic file attachment (data-model.md `file_attachments`). `entityId` has no
 * database-level FK — deliberately polymorphic, mirrors `custom_field_values.entity_id`
 * (research.md §3). `entityType`'s CHECK is extended by a future migration when a second entity type
 * is wired, mirroring `content_items.type`'s own extensible-enum convention. Only `content_item` is
 * wired to a real route surface in this spec.
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
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
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
    unique("file_attachments_storage_key_unique").on(table.storageKey),
    check("file_attachments_entity_type_check", sql`${table.entityType} in ('content_item')`),
    check("file_attachments_status_check", sql`${table.status} in ('pending', 'ready')`),
  ],
);
