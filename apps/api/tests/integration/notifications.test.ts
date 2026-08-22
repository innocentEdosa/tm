import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { notifications } from "../../src/db/schema/notifications";
import { departments } from "../../src/db/schema/departments";

/**
 * The notification system's own CRUD surface (`tenant-notification-routes.ts`) plus proof that the
 * two representative feature integrations (TNA assignment, Training Request submit/approve) actually
 * create notifications through the shared service rather than bypassing it.
 */
describe("Notifications: CRUD, isolation, and feature integrations", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedNotification(
    tenantId: string,
    recipientId: string,
    overrides: { title?: string; isRead?: boolean; createdAt?: Date } = {},
  ) {
    return withTenantDb(tenantId, async (db) => {
      const [row] = await db
        .insert(notifications)
        .values({
          tenantId,
          recipientId,
          type: "system_event",
          title: overrides.title ?? "Test notification",
          message: "Something happened.",
          actionUrl: "/dashboard",
          isRead: overrides.isRead ?? false,
          ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
        })
        .returning();
      return row;
    });
  }

  it("lists only the caller's own notifications, newest first, with an accurate unread count", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    const otherUserId = randomUUID();
    await seedUser(tenantId, otherUserId);

    await seedNotification(tenantId, otherUserId); // must never appear for `userId`
    const older = await seedNotification(tenantId, userId, { createdAt: new Date(Date.now() - 60_000) });
    const newer = await seedNotification(tenantId, userId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const list = await server.inject({ method: "GET", url: "/tenant/notifications", headers });
      expect(list.statusCode).toBe(200);
      const body = list.json();
      expect(body.data.map((n: { id: string }) => n.id)).toEqual([newer.id, older.id]);
      expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 2 });

      const unreadCount = await server.inject({ method: "GET", url: "/tenant/notifications/unread-count", headers });
      expect(unreadCount.json().data.count).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("marking one notification read updates it and the unread count, without affecting others", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    const first = await seedNotification(tenantId, userId);
    await seedNotification(tenantId, userId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const read = await server.inject({ method: "PATCH", url: `/tenant/notifications/${first.id}/read`, headers });
      expect(read.statusCode).toBe(200);
      expect(read.json().data.isRead).toBe(true);
      expect(read.json().data.readAt).not.toBeNull();

      const unreadCount = await server.inject({ method: "GET", url: "/tenant/notifications/unread-count", headers });
      expect(unreadCount.json().data.count).toBe(1);

      const unreadOnly = await server.inject({ method: "GET", url: "/tenant/notifications?unreadOnly=true", headers });
      expect(unreadOnly.json().data.map((n: { id: string }) => n.id)).not.toContain(first.id);
    } finally {
      await server.close();
    }
  });

  it("mark-all-read clears every unread notification for the caller only", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    const otherUserId = randomUUID();
    await seedUser(tenantId, otherUserId);
    await seedNotification(tenantId, userId);
    await seedNotification(tenantId, userId);
    await seedNotification(tenantId, otherUserId);

    const server = await buildTestServer();
    try {
      const markAll = await server.inject({
        method: "POST",
        url: "/tenant/notifications/mark-all-read",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(markAll.statusCode).toBe(200);

      const myCount = await server.inject({
        method: "GET",
        url: "/tenant/notifications/unread-count",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(myCount.json().data.count).toBe(0);

      // The other user's own unread notification is untouched by my mark-all-read.
      const otherCount = await server.inject({
        method: "GET",
        url: "/tenant/notifications/unread-count",
        headers: { "x-test-user-id": otherUserId, "x-test-tenant-id": tenantId },
      });
      expect(otherCount.json().data.count).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("a user can dismiss (delete) their own notification", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    const notification = await seedNotification(tenantId, userId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const del = await server.inject({ method: "DELETE", url: `/tenant/notifications/${notification.id}`, headers });
      expect(del.statusCode).toBe(204);

      const list = await server.inject({ method: "GET", url: "/tenant/notifications", headers });
      expect(list.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("returns 404 (never another user's data) when marking read or deleting a notification that isn't the caller's", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const ownerId = randomUUID();
    await seedUser(tenantId, ownerId);
    const otherUserId = randomUUID();
    await seedUser(tenantId, otherUserId);
    const notification = await seedNotification(tenantId, ownerId);

    const server = await buildTestServer();
    try {
      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": tenantId };

      const read = await server.inject({ method: "PATCH", url: `/tenant/notifications/${notification.id}/read`, headers: otherHeaders });
      expect(read.statusCode).toBe(404);

      const del = await server.inject({ method: "DELETE", url: `/tenant/notifications/${notification.id}`, headers: otherHeaders });
      expect(del.statusCode).toBe(404);

      // Untouched — still exists and still unread for its real owner.
      const ownerList = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: { "x-test-user-id": ownerId, "x-test-tenant-id": tenantId },
      });
      expect(ownerList.json().data).toHaveLength(1);
      expect(ownerList.json().data[0].isRead).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("never leaks another tenant's notifications, even to a same-tenant-shaped request", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedTenant(tenantA);
    await seedTenant(tenantB);
    const userInB = randomUUID();
    await seedUser(tenantB, userInB);
    await seedNotification(tenantB, userInB);

    const server = await buildTestServer();
    try {
      // Same user id, but scoped to tenant A this time — RLS must still hide tenant B's row.
      const crossTenant = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: { "x-test-user-id": userInB, "x-test-tenant-id": tenantA },
      });
      expect(crossTenant.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("starting a TNA exercise creates an in-app notification for the assigned participant", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);
    const participantId = randomUUID();
    await seedUser(tenantId, participantId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Notification Proof", endDate: "2099-12-31", targets: [{ type: "user", userId: participantId }] },
      });
      expect(created.statusCode).toBe(201);
      const exerciseId = created.json().data.id;

      const start = await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });
      expect(start.statusCode).toBe(200);

      const assignments = await server.inject({ method: "GET", url: `/tenant/tna-exercises/${exerciseId}/assignments`, headers });
      const assignmentId = assignments.json().data[0].id;

      const participantNotifications = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: { "x-test-user-id": participantId, "x-test-tenant-id": tenantId },
      });
      const rows = participantNotifications.json().data;
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("tna_assignment_created");
      // Each participant's notification must link to THEIR OWN assignment, not a shared/generic
      // destination — this is the actionUrl-correctness bug found during final review.
      expect(rows[0].metadata).toEqual({ entityType: "tna_assignment", entityId: assignmentId });
      expect(rows[0].actionUrl).toBe(`/strategy/training-needs-analysis/my/${assignmentId}`);
      expect(rows[0].isRead).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("manually adding a participant to an already-started exercise links their notification to their own new assignment", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);
    const firstParticipantId = randomUUID();
    await seedUser(tenantId, firstParticipantId);
    const manuallyAddedId = randomUUID();
    await seedUser(tenantId, manuallyAddedId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: "Manual Add Proof", endDate: "2099-12-31", targets: [{ type: "user", userId: firstParticipantId }] },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });

      const added = await server.inject({
        method: "POST",
        url: `/tenant/tna-exercises/${exerciseId}/assignments`,
        headers,
        payload: { userId: manuallyAddedId },
      });
      expect(added.statusCode).toBe(201);
      const newAssignmentId = added.json().data.id;

      const notifications = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: { "x-test-user-id": manuallyAddedId, "x-test-tenant-id": tenantId },
      });
      const rows = notifications.json().data;
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toEqual({ entityType: "tna_assignment", entityId: newAssignmentId });
      expect(rows[0].actionUrl).toBe(`/strategy/training-needs-analysis/my/${newAssignmentId}`);

      // The original (Start-time) participant must be unaffected by the manual add — one
      // notification each, never a shared/duplicated one.
      const firstParticipantNotifications = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: { "x-test-user-id": firstParticipantId, "x-test-tenant-id": tenantId },
      });
      expect(firstParticipantNotifications.json().data).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("truncates an overlong title so the notification message stays concise", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);
    const participantId = randomUUID();
    await seedUser(tenantId, participantId);
    const longTitle = "A".repeat(200);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/tna-exercises",
        headers,
        payload: { title: longTitle, endDate: "2099-12-31", targets: [{ type: "user", userId: participantId }] },
      });
      const exerciseId = created.json().data.id;
      await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers });

      const notifications = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: { "x-test-user-id": participantId, "x-test-tenant-id": tenantId },
      });
      const message: string = notifications.json().data[0].message;
      expect(message.length).toBeLessThan(longTitle.length);
      expect(message).toContain("…");
    } finally {
      await server.close();
    }
  });

  it("submitting a training request notifies every approver, and approving it notifies the creator", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const requesterId = randomUUID();
    await seedUser(tenantId, requesterId);
    await seedUserWithRole(tenantId, requesterId, ["training_request.manage.all"]);
    const approverId = randomUUID();
    await seedUser(tenantId, approverId);
    await seedUserWithRole(tenantId, approverId, ["training_request.approve"]);

    const deptId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId, name: "Engineering" }).returning({ id: departments.id });
      return dept.id;
    });

    const server = await buildTestServer();
    try {
      const requesterHeaders = { "x-test-user-id": requesterId, "x-test-tenant-id": tenantId };
      const created = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers: requesterHeaders,
        payload: { title: "Advanced SQL Training", priority: "medium", departmentId: deptId, status: "submitted" },
      });
      expect(created.statusCode).toBe(201);
      const trainingNeedId = created.json().data.id;

      const approverNotifications = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: { "x-test-user-id": approverId, "x-test-tenant-id": tenantId },
      });
      const approverRows = approverNotifications.json().data;
      expect(approverRows).toHaveLength(1);
      expect(approverRows[0].type).toBe("training_request_submitted");
      expect(approverRows[0].actionUrl).toBe(`/learning/training-requests/${trainingNeedId}`);

      const approve = await server.inject({
        method: "POST",
        url: `/tenant/training-needs/${trainingNeedId}/approve`,
        headers: { "x-test-user-id": approverId, "x-test-tenant-id": tenantId },
      });
      expect(approve.statusCode).toBe(200);

      const requesterNotifications = await server.inject({
        method: "GET",
        url: "/tenant/notifications",
        headers: requesterHeaders,
      });
      const requesterRows = requesterNotifications.json().data;
      expect(requesterRows).toHaveLength(1);
      expect(requesterRows[0].type).toBe("training_request_approved");
    } finally {
      await server.close();
    }
  });
});
