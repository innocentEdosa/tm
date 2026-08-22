import { and, desc, eq, sql } from "drizzle-orm";
import type { KnownNotificationType, NotificationType } from "@tm/types";
import type { Db } from "../db/client";
import { notifications } from "../db/schema/notifications";

export interface CreateNotificationInput {
  tenantId: string;
  recipientId: string;
  /** The strict union, not the loose display-side `NotificationType` — a typo'd literal here is a
   * compile error, since nothing else in this codebase (no DB CHECK constraint) would otherwise
   * catch it. */
  type: KnownNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  actionUrl?: string;
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  actionUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Keeps a notification's title/message readable regardless of how long the upstream, user-supplied
 * data (an exercise title, a training request title, ...) happens to be — neither TNA exercise
 * titles nor training-need titles have a max-length validation today, so this is the notification
 * layer's own defense against a pathologically long title blowing up the bell dropdown. */
export function truncateForNotification(value: string, maxLength = 80): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function toRow(row: typeof notifications.$inferSelect): NotificationRow {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    actionUrl: row.actionUrl,
    isRead: row.isRead,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The single place anything in this codebase creates a notification — every feature calls this (or
 * `createNotifications` for a fan-out) instead of inserting into the `notifications` table directly,
 * so recipient resolution, formatting, and (later) additional delivery channels all have exactly one
 * choke point to extend. Mirrors `mail/send-mail.ts`'s own role for email: a thin, generic wrapper
 * every feature-specific caller (e.g. a future `tna-assignment-notifier.ts`) builds on top of.
 *
 * Takes `tenantDb` (the caller's own RLS-scoped, per-request transaction), never a raw pool — a
 * notification is always created within the same tenant-scoped transaction as the action that
 * triggered it, so it either commits alongside that action or rolls back with it, exactly like every
 * other write in this codebase.
 */
export async function createNotification(tenantDb: Db, input: CreateNotificationInput): Promise<NotificationRow> {
  const [row] = await tenantDb
    .insert(notifications)
    .values({
      tenantId: input.tenantId,
      recipientId: input.recipientId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? null,
      actionUrl: input.actionUrl ?? null,
    })
    .returning();
  return toRow(row);
}

/** Fan-out variant — one notification per recipient, same type/title/message/metadata/actionUrl
 * shape (e.g. every participant assigned to the same TNA exercise). A no-op on an empty recipient
 * list, matching `notifyTnaParticipants`'s own early-return convention. */
export async function createNotifications(
  tenantDb: Db,
  input: Omit<CreateNotificationInput, "recipientId"> & { recipientIds: string[] },
): Promise<NotificationRow[]> {
  const recipientIds = Array.from(new Set(input.recipientIds));
  if (recipientIds.length === 0) return [];
  const rows = await tenantDb
    .insert(notifications)
    .values(
      recipientIds.map((recipientId) => ({
        tenantId: input.tenantId,
        recipientId,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata ?? null,
        actionUrl: input.actionUrl ?? null,
      })),
    )
    .returning();
  return rows.map(toRow);
}

/** Bulk-insert variant for when each recipient needs genuinely different content — e.g. each TNA
 * participant's notification must link to *their own* assignment, not a shared one — unlike
 * `createNotifications`' identical-content fan-out (same title/message/actionUrl for everyone,
 * e.g. every approver notified about the same training request). Still a single multi-row INSERT,
 * not one query per recipient. */
export async function createNotificationsForRecipients(tenantDb: Db, entries: CreateNotificationInput[]): Promise<NotificationRow[]> {
  if (entries.length === 0) return [];
  const rows = await tenantDb
    .insert(notifications)
    .values(
      entries.map((entry) => ({
        tenantId: entry.tenantId,
        recipientId: entry.recipientId,
        type: entry.type,
        title: entry.title,
        message: entry.message,
        metadata: entry.metadata ?? null,
        actionUrl: entry.actionUrl ?? null,
      })),
    )
    .returning();
  return rows.map(toRow);
}

export interface ListNotificationsOptions {
  page: number;
  pageSize: number;
  unreadOnly?: boolean;
}

export interface ListNotificationsResult {
  rows: NotificationRow[];
  total: number;
}

/** Always scoped to `recipientId` in addition to `tenantId` — RLS alone only enforces the tenant
 * boundary; a user's own notifications are a stricter, per-row scope RLS doesn't know about, so every
 * query here filters on both. */
export async function listNotifications(
  tenantDb: Db,
  tenantId: string,
  recipientId: string,
  { page, pageSize, unreadOnly }: ListNotificationsOptions,
): Promise<ListNotificationsResult> {
  const conditions = [eq(notifications.tenantId, tenantId), eq(notifications.recipientId, recipientId)];
  if (unreadOnly) {
    conditions.push(eq(notifications.isRead, false));
  }

  const [{ count: total }] = await tenantDb
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(...conditions));

  const rows = await tenantDb
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows: rows.map(toRow), total };
}

export async function countUnreadNotifications(tenantDb: Db, tenantId: string, recipientId: string): Promise<number> {
  const [{ count }] = await tenantDb
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.recipientId, recipientId), eq(notifications.isRead, false)));
  return count;
}

/** Returns `null` if the notification doesn't exist or doesn't belong to `recipientId` — the caller
 * (route) turns that into a 404, never a 403, so it never confirms another user's notification
 * exists. Marking an already-read notification read again is a no-op, not an error, same convention
 * every other idempotent status transition in this codebase follows (e.g. training-needs `approve`). */
export async function markNotificationAsRead(tenantDb: Db, recipientId: string, notificationId: string): Promise<NotificationRow | null> {
  const [existing] = await tenantDb.select().from(notifications).where(eq(notifications.id, notificationId));
  if (!existing || existing.recipientId !== recipientId) return null;
  if (existing.isRead) return toRow(existing);

  const [updated] = await tenantDb
    .update(notifications)
    .set({ isRead: true, readAt: new Date(), updatedAt: new Date() })
    .where(eq(notifications.id, notificationId))
    .returning();
  return toRow(updated);
}

export async function markAllNotificationsAsRead(tenantDb: Db, tenantId: string, recipientId: string): Promise<void> {
  await tenantDb
    .update(notifications)
    .set({ isRead: true, readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.recipientId, recipientId), eq(notifications.isRead, false)));
}

/** Returns `false` (not found/not owned) rather than throwing — the route turns that into a 404,
 * same reasoning as `markNotificationAsRead`. */
export async function deleteNotification(tenantDb: Db, recipientId: string, notificationId: string): Promise<boolean> {
  const [existing] = await tenantDb.select({ id: notifications.id, recipientId: notifications.recipientId }).from(notifications).where(eq(notifications.id, notificationId));
  if (!existing || existing.recipientId !== recipientId) return false;
  await tenantDb.delete(notifications).where(eq(notifications.id, notificationId));
  return true;
}
