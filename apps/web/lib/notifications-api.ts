"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Notification, NotificationListResponse, UnreadNotificationCountResponse } from "@tm/types";
import { tenantFetch } from "./tenant-api-client";

const PAGE_SIZE = 20;
// The bell badge polls on this interval — cheap (a single indexed count query) and simple, matching
// the "no realtime infra exists yet" state of this codebase (research.md-equivalent finding: no
// websockets/SSE/queue anywhere). Every mutation below also invalidates immediately, so the badge
// never waits a full interval to reflect the user's own actions.
const UNREAD_COUNT_POLL_MS = 30_000;

// A shared `["notifications", subdomain, userId, ...]` prefix for every query below — lets
// `useInvalidateNotifications` invalidate the list AND the unread count with one call instead of one
// per query shape, and lets React Query's partial key matching do the rest.
//
// `userId` is part of the key, not just `subdomain` — login/logout in this app are client-side
// navigations (`router.push` + `router.refresh()`, see `tenant-login-form.tsx` and
// `app-shell.tsx`'s `handleLogout`), never a hard page reload, so the one `QueryClient` created in
// `query-provider.tsx` survives across a user switch on the same tenant subdomain within the same
// browser tab. Without `userId` in the key, a second account logging in right after another logs out
// would briefly render the FIRST account's cached notifications until the query happened to refetch
// (confirmed live: switching from one seeded user to another showed the previous user's notification
// under the new user's identity for one render). Keying on `userId` makes that a cache miss instead —
// a different user is simply a different, independent cache entry, with no dependency on how the
// navigation between them happened.
function notificationsKey(subdomain: string, userId: string, unreadOnly: boolean) {
  return ["notifications", subdomain, userId, "list", { unreadOnly }] as const;
}

function unreadCountKey(subdomain: string, userId: string) {
  return ["notifications", subdomain, userId, "unread-count"] as const;
}

/** Paginated notification list — `enabled` lets a caller (the bell dropdown) defer fetching until
 * it's actually opened, rather than loading history the moment every page mounts.
 *
 * `staleTime: 0` (overriding the app-wide 30s default from `query-provider.tsx`) — every time the
 * dropdown opens it should show the current state, not whatever was cached up to 30s ago. Polls on
 * the same interval as the unread count, but only while `enabled` (the dropdown is actually open) —
 * otherwise an open dropdown could silently drift out of sync with the badge in the background. */
export function useNotifications(
  subdomain: string,
  userId: string,
  { unreadOnly = false, enabled = true }: { unreadOnly?: boolean; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: notificationsKey(subdomain, userId, unreadOnly),
    queryFn: () =>
      tenantFetch<NotificationListResponse>(`/notifications?pageSize=${PAGE_SIZE}${unreadOnly ? "&unreadOnly=true" : ""}`, { subdomain }),
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? UNREAD_COUNT_POLL_MS : false,
  });
}

/** The bell badge's own lightweight query — deliberately separate from `useNotifications` so the
 * badge (mounted globally, polled continuously) never fetches or re-renders off the full list. */
export function useUnreadNotificationCount(subdomain: string, userId: string) {
  return useQuery({
    queryKey: unreadCountKey(subdomain, userId),
    queryFn: () => tenantFetch<UnreadNotificationCountResponse>("/notifications/unread-count", { subdomain }),
    refetchInterval: UNREAD_COUNT_POLL_MS,
  });
}

function useInvalidateNotifications(subdomain: string, userId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["notifications", subdomain, userId] });
  };
}

export function useMarkNotificationAsRead(subdomain: string, userId: string) {
  const invalidate = useInvalidateNotifications(subdomain, userId);
  return useMutation({
    mutationFn: (notificationId: string) =>
      tenantFetch<{ success: boolean; data: Notification }>(`/notifications/${notificationId}/read`, { method: "PATCH", subdomain }),
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsAsRead(subdomain: string, userId: string) {
  const invalidate = useInvalidateNotifications(subdomain, userId);
  return useMutation({
    mutationFn: () => tenantFetch<{ success: boolean }>("/notifications/mark-all-read", { method: "POST", subdomain }),
    onSuccess: invalidate,
  });
}

export function useDeleteNotification(subdomain: string, userId: string) {
  const invalidate = useInvalidateNotifications(subdomain, userId);
  return useMutation({
    mutationFn: (notificationId: string) => tenantFetch<void>(`/notifications/${notificationId}`, { method: "DELETE", subdomain }),
    onSuccess: invalidate,
  });
}
