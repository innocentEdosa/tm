import { pgTable, uuid, text, integer, numeric, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A tenant-scoped, single current-state row per (tenant, user, content item) — never a full attempt
 * history (data-model.md `learner_content_progress`). `contentItemId` has no database-level FK,
 * mirroring `file_attachments.entityId` (research.md §1) — a real FK would either block deleting a
 * touched content item (RESTRICT) or silently destroy learner history (CASCADE).
 */
export const learnerContentProgress = pgTable(
  "learner_content_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    contentItemId: uuid("content_item_id").notNull(),
    status: text("status").notNull().default("not_started"),
    scoreRaw: numeric("score_raw", { precision: 12, scale: 4, mode: "number" }),
    scoreMin: numeric("score_min", { precision: 12, scale: 4, mode: "number" }),
    scoreMax: numeric("score_max", { precision: 12, scale: 4, mode: "number" }),
    bookmark: text("bookmark"),
    suspendData: text("suspend_data"),
    sessionTimeSeconds: integer("session_time_seconds").notNull().default(0),
    totalTimeSeconds: integer("total_time_seconds").notNull().default(0),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp("exited_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("learner_content_progress_tenant_user_content_item_unique").on(
      table.tenantId,
      table.userId,
      table.contentItemId,
    ),
    index("learner_content_progress_tenant_id_content_item_id_idx").on(table.tenantId, table.contentItemId),
    check(
      "learner_content_progress_status_check",
      sql`${table.status} in ('not_started', 'in_progress', 'completed', 'failed')`,
    ),
  ],
);
