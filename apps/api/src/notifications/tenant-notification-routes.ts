import type { FastifyPluginAsync } from "fastify";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import {
  countUnreadNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "./notification-service";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * A user's own in-app notifications. Every route here filters on `request.user.id` as the recipient
 * in addition to the tenant boundary RLS already enforces (`plugins/tenant-context.ts`) — RLS alone
 * would let any tenant user read any other tenant user's notifications, since they all share one
 * tenant. Mark-read/delete additionally treat "exists but belongs to someone else" as 404, never 403,
 * so a caller can never confirm another user's notification exists (same convention as
 * `tenant-training-needs-routes.ts`'s own out-of-scope handling).
 */
const tenantNotificationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tenant/notifications — paginated, newest first, optional unread-only filter.
  fastify.get<{ Querystring: { page?: string; pageSize?: string; unreadOnly?: string } }>(
    "/tenant/notifications",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
      const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(request.query.pageSize ?? "", 10) || DEFAULT_PAGE_SIZE));
      const unreadOnly = request.query.unreadOnly === "true";

      const { rows, total } = await listNotifications(request.tenantDb, request.user!.tenantId, request.user!.id, {
        page,
        pageSize,
        unreadOnly,
      });

      return { success: true, data: rows, pagination: { page, pageSize, total } };
    },
  );

  // GET /tenant/notifications/unread-count — the bell badge's own lightweight endpoint, kept
  // separate from the list so the badge (polled far more often than the list is opened) never pays
  // for fetching and serializing full notification rows just to render a number.
  fastify.get(
    "/tenant/notifications/unread-count",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      const count = await countUnreadNotifications(request.tenantDb, request.user!.tenantId, request.user!.id);
      return { success: true, data: { count } };
    },
  );

  // PATCH /tenant/notifications/:id/read
  fastify.patch<{ Params: { id: string } }>(
    "/tenant/notifications/:id/read",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const updated = await markNotificationAsRead(request.tenantDb, request.user!.id, request.params.id);
      if (!updated) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      return { success: true, data: updated };
    },
  );

  // POST /tenant/notifications/mark-all-read
  fastify.post(
    "/tenant/notifications/mark-all-read",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      await markAllNotificationsAsRead(request.tenantDb, request.user!.tenantId, request.user!.id);
      return { success: true };
    },
  );

  // DELETE /tenant/notifications/:id — dismiss. Notifications are ephemeral, disposable records (no
  // downstream feature reads or reports on them the way it does e.g. a training-needs submission), so
  // this is a real delete rather than the `archivedAt`-style soft-delete used elsewhere for records
  // with lasting reporting/audit value.
  fastify.delete<{ Params: { id: string } }>(
    "/tenant/notifications/:id",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const deleted = await deleteNotification(request.tenantDb, request.user!.id, request.params.id);
      if (!deleted) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      return reply.code(204).send();
    },
  );
};

export default tenantNotificationRoutes;
