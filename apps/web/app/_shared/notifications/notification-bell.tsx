"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, X } from "lucide-react";
import { Popover } from "@tm/ui";
import type { Notification } from "@tm/types";
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  useDeleteNotification,
} from "@/lib/notifications-api";

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Self-contained notification bell + dropdown — fully independent of `AppShell` (which only renders
 * whatever `topbar.notificationsSlot` it's given, same as how `AiAssistantLauncher` is a self-contained
 * widget mounted inside the dashboard layout rather than something `AppShell` itself knows about). Owns
 * its own `Popover` (the same trigger+portal+click-outside mechanics `FlagConfirmPopover` in
 * `reviews-tab.tsx` already uses elsewhere), so it can be dropped into any shell without that shell
 * needing to know anything about notifications.
 *
 * The list query only runs while the dropdown is open (`enabled: open`) — the unread-count badge is
 * the one thing polled continuously; fetching notification history on every page load/navigation
 * would be wasted work nobody's looking at yet.
 */
export function NotificationBell({ subdomain, userId }: { subdomain: string; userId: string }) {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const router = useRouter();

  const unreadCountQuery = useUnreadNotificationCount(subdomain, userId);
  const notificationsQuery = useNotifications(subdomain, userId, { unreadOnly, enabled: open });
  const markAsRead = useMarkNotificationAsRead(subdomain, userId);
  const markAllAsRead = useMarkAllNotificationsAsRead(subdomain, userId);
  const deleteNotification = useDeleteNotification(subdomain, userId);

  const unreadCount = unreadCountQuery.data?.data.count ?? 0;
  const notifications = notificationsQuery.data?.data ?? [];

  function handleItemClick(notification: Notification, close: () => void) {
    if (!notification.isRead) markAsRead.mutate(notification.id);
    close();
    if (notification.actionUrl) router.push(notification.actionUrl);
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={380}
      trigger={
        <button type="button" className="shell-topbar-bell" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && <span className="shell-topbar-bell-dot" />}
        </button>
      }
    >
      {(close) => (
        <div className="flex max-h-[28rem] flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-primary">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-cta hover:underline disabled:opacity-50"
                disabled={markAllAsRead.isPending}
                onClick={() => markAllAsRead.mutate()}
              >
                <Check className="h-3.5 w-3.5" />
                Mark all as read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notificationsQuery.isLoading && <div className="px-4 py-8 text-center text-sm text-muted">Loading…</div>}
            {notificationsQuery.isError && (
              <div className="px-4 py-8 text-center text-sm text-red-600">Couldn&apos;t load notifications.</div>
            )}
            {!notificationsQuery.isLoading && !notificationsQuery.isError && notifications.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">
                {unreadOnly ? "No unread notifications." : "You're all caught up."}
              </div>
            )}
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`group flex items-start gap-2 border-b border-border px-4 py-3 last:border-b-0 hover:bg-slate-50 ${
                  notification.isRead ? "" : "bg-cta/5"
                }`}
              >
                <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => handleItemClick(notification, close)}>
                  <span className="flex items-center gap-2">
                    {!notification.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cta" />}
                    <span className={`truncate text-sm ${notification.isRead ? "font-medium text-secondary" : "font-semibold text-primary"}`}>
                      {notification.title}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{notification.message}</span>
                  <span className="mt-1 block text-xs text-slate-400">{timeAgo(notification.createdAt)}</span>
                </button>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  className="shrink-0 rounded p-1 text-slate-300 opacity-60 transition-opacity hover:bg-slate-100 hover:text-secondary hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => deleteNotification.mutate(notification.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-border px-4 py-2">
            <button type="button" className="text-xs font-medium text-secondary hover:underline" onClick={() => setUnreadOnly((v) => !v)}>
              {unreadOnly ? "Show all" : "Show unread only"}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
