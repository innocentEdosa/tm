export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  success: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
}

/** Video Lesson Upload — how many multipart part-upload URLs are requested/handed out at once, never
 * the whole upload's worth up front (a cancelled or failed upload for a multi-GB file would otherwise
 * mean generating, and potentially exposing, presigned URLs for parts that are never sent). Shared by
 * `apps/api`'s multipart routes (validates a batch request never exceeds this) and `apps/web`'s upload
 * client (paces its own upload loop to match) — the one place this number lives. */
export const VIDEO_UPLOAD_PART_BATCH_SIZE = 10;

/**
 * Notification system — shared by `apps/api`'s notification service/routes and `apps/web`'s
 * notification bell so both sides agree on the same taxonomy without a database migration being
 * required every time a new notification type is introduced (the `notifications.type` column is
 * plain `text`, not a CHECK-constrained enum, precisely so this list can grow here alone).
 *
 * Add a new type by appending a string literal here — no other core-infrastructure change is
 * required. A feature calling `notificationService.createNotification` with a type not yet listed
 * here is still accepted by the database (and by other clients, which treat an unrecognized type as
 * generic/unstyled), but should add it here for type safety and any custom rendering.
 */
export const NOTIFICATION_TYPES = [
  "tna_assignment_created",
  "training_request_submitted",
  "training_request_approved",
] as const;

/** Strict union — use this for anything that CREATES a notification (e.g.
 * `notificationService.createNotification`'s `type` field), so a typo'd literal is a compile error
 * instead of silently becoming an unrecognized notification type in the database. */
export type KnownNotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Loose union (known types, plus any other string) — use this for anything that READS/DISPLAYS a
 * notification (e.g. the `Notification` DTO below), so a client never breaks rendering a type it
 * doesn't recognize yet (an older frontend build reading a type added by a newer backend, or vice
 * versa). Deliberately NOT used for creation — see `KnownNotificationType`. */
export type NotificationType = KnownNotificationType | (string & {});

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Structured, type-specific context (e.g. `{ entityType: "tna_assignment", entityId }`) — lets a
   * future non-web client resolve its own destination without depending on `actionUrl`. */
  metadata: Record<string, unknown> | null;
  /** Web-relative route to navigate to on click, if this notification has one. */
  actionUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationListResponse {
  success: boolean;
  data: Notification[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface UnreadNotificationCountResponse {
  success: boolean;
  data: { count: number };
}
