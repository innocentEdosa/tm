import { pgTable, uuid, text, boolean, jsonb, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A single in-app notification for one recipient. The generic, feature-agnostic sink every module in
 * this app writes to via `notifications/notification-service.ts` — no feature is ever expected to
 * insert into this table directly.
 *
 * `type` is deliberately plain `text` with no CHECK constraint, unlike every other "status"-shaped
 * column in this codebase (e.g. `tna_assignments.status`, `training_needs.status`): those are closed,
 * small, rarely-changing lifecycle states, while a notification `type` is an open, ever-growing
 * taxonomy that unrelated features will keep adding to. A CHECK constraint would mean a migration for
 * every new notification type a future feature wants to send, which defeats the point of a shared,
 * reusable notification system. Type safety instead lives at the application layer — see
 * `NotificationType` in `@tm/types`, which both API and web import.
 *
 * `metadata` (jsonb, mirrors `file_attachments.metadata`) carries structured, type-specific context
 * (e.g. `{ entityType: "tna_assignment", entityId }`) without ever needing its own column per
 * notification type. `actionUrl` is a web-relative route the frontend can navigate to directly; it's
 * kept separate from `metadata` (rather than being the only representation) so a future non-web client
 * can instead resolve its own destination from `type` + `metadata.entityId` without depending on a
 * web-specific path string.
 *
 * `isRead`/`readAt` follow the same boolean-gate-plus-timestamp shape as `tna_assignments.status`/
 * `submittedAt` (flips once, timestamp records when).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    actionUrl: text("action_url"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "My notifications, most recent first" — the list endpoint's own primary access pattern.
    index("notifications_tenant_id_recipient_id_created_at_idx").on(table.tenantId, table.recipientId, table.createdAt),
    // Partial index — the unread-count badge is read far more often (polled) than the full list, and
    // only ever needs unread rows, so this stays small regardless of how large a recipient's read
    // history grows.
    index("notifications_tenant_id_recipient_id_unread_idx")
      .on(table.tenantId, table.recipientId)
      .where(sql`${table.isRead} = false`),
  ],
);
