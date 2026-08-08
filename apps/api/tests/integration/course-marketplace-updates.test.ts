import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";
import { __setMailSenderForTesting } from "../../src/tenant-auth/mailer";
import { RecordingMailSender } from "../unit/fixtures/recording-mail-sender";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { learnerContentProgress } from "../../src/db/schema/learner-content-progress";
import { eq } from "drizzle-orm";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function seedTenantWithCourseManage(): Promise<{ headers: Headers; tenantId: string; userId: string }> {
  const tenantId = randomUUID();
  await seedTenant(tenantId);
  const userId = randomUUID();
  await seedUser(tenantId, userId);
  await seedUserWithRole(tenantId, userId, ["course.manage"]);
  return { headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId }, tenantId, userId };
}

async function createActivePlatformCourseWithOneModuleOneItem(server: Server, adminHeaders: Headers) {
  const created = await server.inject({
    method: "POST",
    url: "/admin/platform-courses",
    headers: adminHeaders,
    payload: { title: `Course ${randomUUID()}`, categoryName: "Compliance", deliveryMode: "self_paced", duration: { value: 15, unit: "minutes" } },
  });
  const courseId = created.json().data.id as string;
  const module = await server.inject({ method: "POST", url: `/admin/platform-courses/${courseId}/modules`, headers: adminHeaders, payload: { title: "Module 1" } });
  const moduleId = module.json().data.id as string;
  const item = await server.inject({
    method: "POST",
    url: `/admin/platform-course-modules/${moduleId}/content-items`,
    headers: adminHeaders,
    payload: { type: "article", title: "Item 1", payload: { body: "hello" } },
  });
  const itemId = item.json().data.id as string;
  await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { status: "active" } });
  return { courseId, moduleId, itemId };
}

describe("Course Marketplace Updates (spec 032) — notify, apply, dismiss, file preservation", () => {
  afterEach(() => {
    __setMailSenderForTesting(new ZeptoMailSender());
    __setStorageClientForTesting(new R2StorageClient());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("does not send a second notification for a further edit before the tenant reacts to the first (FR-006, research.md §5)", async () => {
    const mail = new RecordingMailSender();
    __setMailSenderForTesting(mail);
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId } = await createActivePlatformCourseWithOneModuleOneItem(server, adminHeaders);
      await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });

      await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { title: "Edit 1" } });
      expect(mail.received).toHaveLength(1);

      await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { title: "Edit 2" } });
      expect(mail.received).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("surfaces updateAvailable on GET /tenant/courses once the platform source is edited, and clears it after apply", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId } = await createActivePlatformCourseWithOneModuleOneItem(server, adminHeaders);
      const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      const tenantCourseId = select.json().data.courseId as string;

      const before = await server.inject({ method: "GET", url: `/tenant/courses/${tenantCourseId}`, headers: tenantHeaders });
      expect(before.json().data.updateAvailable).toBe(false);

      await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { title: "New Title" } });

      const after = await server.inject({ method: "GET", url: `/tenant/courses/${tenantCourseId}`, headers: tenantHeaders });
      expect(after.json().data.updateAvailable).toBe(true);

      const apply = await server.inject({ method: "POST", url: `/tenant/courses/${tenantCourseId}/marketplace-update/apply`, headers: tenantHeaders });
      expect(apply.statusCode).toBe(200);
      expect(apply.json().data.updateAvailable).toBe(false);
      expect(apply.json().data.title).toBe("New Title");
    } finally {
      await server.close();
    }
  });

  it("apply reconciles curriculum (new module/item picked up) without touching existing learner_content_progress (FR-007)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders, tenantId, userId } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId, itemId } = await createActivePlatformCourseWithOneModuleOneItem(server, adminHeaders);
      const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      const tenantCourseId = select.json().data.courseId as string;

      const curriculumBefore = await server.inject({ method: "GET", url: `/tenant/courses/${tenantCourseId}/curriculum`, headers: tenantHeaders });
      const tenantItemId = curriculumBefore.json().data.modules[0].contentItems[0].id as string;

      // A learner has progress on the original content item.
      const progressId = randomUUID();
      await withTenantDb(tenantId, async (db) => {
        await db.insert(learnerContentProgress).values({
          id: progressId,
          tenantId,
          userId,
          contentItemId: tenantItemId,
          status: "completed",
        });
      });

      // Platform source gains a second module/item after the clone.
      const newModule = await server.inject({ method: "POST", url: `/admin/platform-courses/${courseId}/modules`, headers: adminHeaders, payload: { title: "Module 2" } });
      const newModuleId = newModule.json().data.id as string;
      await server.inject({
        method: "POST",
        url: `/admin/platform-course-modules/${newModuleId}/content-items`,
        headers: adminHeaders,
        payload: { type: "article", title: "Item 2", payload: { body: "world" } },
      });

      const apply = await server.inject({ method: "POST", url: `/tenant/courses/${tenantCourseId}/marketplace-update/apply`, headers: tenantHeaders });
      expect(apply.statusCode).toBe(200);
      expect(apply.json().data.moduleCount).toBe(2);

      const curriculumAfter = await server.inject({ method: "GET", url: `/tenant/courses/${tenantCourseId}/curriculum`, headers: tenantHeaders });
      const modules = curriculumAfter.json().data.modules as { id: string; contentItems: { id: string }[] }[];
      expect(modules).toHaveLength(2);
      // The original content item kept its tenant-side row id (matched by source id, updated in
      // place, not deleted+recreated) — the exact mechanism that lets progress survive untouched.
      expect(modules.some((m) => m.contentItems.some((i) => i.id === tenantItemId))).toBe(true);

      const progressAfter = await withTenantDb(tenantId, async (db) =>
        db.select().from(learnerContentProgress).where(eq(learnerContentProgress.id, progressId)),
      );
      expect(progressAfter).toHaveLength(1);
      expect(progressAfter[0].status).toBe("completed");
      expect(progressAfter[0].contentItemId).toBe(tenantItemId);
    } finally {
      await server.close();
    }
  });

  it("dismiss leaves the course completely unchanged, and the update-available state returns only after a further edit (FR-008)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId } = await createActivePlatformCourseWithOneModuleOneItem(server, adminHeaders);
      const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      const tenantCourseId = select.json().data.courseId as string;

      await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { title: "Renamed Upstream" } });

      const dismiss = await server.inject({ method: "POST", url: `/tenant/courses/${tenantCourseId}/marketplace-update/dismiss`, headers: tenantHeaders });
      expect(dismiss.statusCode).toBe(200);
      expect(dismiss.json().data.updateAvailable).toBe(false);
      // The tenant's own title is untouched by dismissal — still whatever it was cloned as.
      expect(dismiss.json().data.title).not.toBe("Renamed Upstream");

      const dismissAgain = await server.inject({ method: "POST", url: `/tenant/courses/${tenantCourseId}/marketplace-update/dismiss`, headers: tenantHeaders });
      expect(dismissAgain.statusCode).toBe(422);

      await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { title: "Renamed Again" } });
      const after = await server.inject({ method: "GET", url: `/tenant/courses/${tenantCourseId}`, headers: tenantHeaders });
      expect(after.json().data.updateAvailable).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("replacing a course image on a course with a fulfilled selection never deletes the prior R2 object (research.md §3)", async () => {
    const recording = new RecordingStorageClient();
    __setStorageClientForTesting(recording);
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId } = await createActivePlatformCourseWithOneModuleOneItem(server, adminHeaders);

      const firstUpload = await server.inject({
        method: "POST",
        url: `/admin/platform-courses/${courseId}/image`,
        headers: adminHeaders,
        payload: { fileName: "first.png", contentType: "image/png", sizeBytes: 100 },
      });
      const firstKey = recording.uploadedKeys[0].key;
      recording.simulateUpload(firstKey, 100);
      await server.inject({ method: "POST", url: `/admin/platform-file-attachments/${firstUpload.json().data.id}/confirm`, headers: adminHeaders });

      await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });

      const secondUpload = await server.inject({
        method: "POST",
        url: `/admin/platform-courses/${courseId}/image`,
        headers: adminHeaders,
        payload: { fileName: "second.png", contentType: "image/png", sizeBytes: 200 },
      });
      const secondKey = recording.uploadedKeys[1].key;
      recording.simulateUpload(secondKey, 200);
      await server.inject({ method: "POST", url: `/admin/platform-file-attachments/${secondUpload.json().data.id}/confirm`, headers: adminHeaders });

      // The first object was never deleted, even though the course now has a fulfilled selection —
      // a tenant that hasn't applied this update yet still points at it.
      expect(recording.deletedKeys).not.toContain(firstKey);
      const head = await recording.headObject(firstKey);
      expect(head.exists).toBe(true);
    } finally {
      await server.close();
    }
  });
});
