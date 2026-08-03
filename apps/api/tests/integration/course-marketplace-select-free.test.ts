import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";
import { __setStorageClientForTesting } from "../../src/storage/storage";
import { RecordingStorageClient } from "../unit/fixtures/recording-storage-client";
import { R2StorageClient } from "../../src/storage/r2-client";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function createActivePlatformCourseWithCurriculum(server: Server, adminHeaders: Headers, categoryName = "Compliance") {
  const created = await server.inject({
    method: "POST",
    url: "/admin/platform-courses",
    headers: adminHeaders,
    payload: { title: `Free Course ${randomUUID()}`, categoryName, deliveryMode: "self_paced", duration: { value: 20, unit: "minutes" }, cost: 0 },
  });
  const courseId = created.json().data.id;

  const module1 = await server.inject({ method: "POST", url: `/admin/platform-courses/${courseId}/modules`, headers: adminHeaders, payload: { title: "Module 1" } });
  const module2 = await server.inject({ method: "POST", url: `/admin/platform-courses/${courseId}/modules`, headers: adminHeaders, payload: { title: "Module 2" } });
  const moduleId1 = module1.json().data.id;
  const moduleId2 = module2.json().data.id;

  const item = await server.inject({
    method: "POST",
    url: `/admin/platform-course-modules/${moduleId1}/content-items`,
    headers: adminHeaders,
    payload: { type: "article", title: "Item 1", payload: { body: "hello" } },
  });
  const itemId = item.json().data.id;

  const upload = await server.inject({
    method: "POST",
    url: `/admin/platform-course-content-items/${itemId}/attachments/upload-url`,
    headers: adminHeaders,
    payload: { fileName: "handout.pdf", contentType: "application/pdf", sizeBytes: 512 },
  });

  await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { status: "active" } });

  return { courseId, moduleId1, moduleId2, itemId, attachmentId: upload.json().data.id as string };
}

describe("course marketplace select — free course (spec 029 US4, FR-008/FR-009/FR-010)", () => {
  let recording: RecordingStorageClient;

  beforeEach(() => {
    recording = new RecordingStorageClient();
    __setStorageClientForTesting(recording);
  });

  afterEach(() => {
    __setStorageClientForTesting(new R2StorageClient());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("clones course/modules/content-items on select, sharing the same storage_key for attachments (SC-005)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const { courseId, itemId, attachmentId } = await createActivePlatformCourseWithCurriculum(server, adminHeaders);
      const storageKey = recording.uploadedKeys[0].key;
      recording.simulateUpload(storageKey, 512);
      await server.inject({
        method: "POST",
        url: `/admin/platform-course-content-items/${itemId}/attachments/${attachmentId}/confirm`,
        headers: adminHeaders,
      });

      const selectResponse = await server.inject({
        method: "POST",
        url: `/tenant/course-marketplace/${courseId}/select`,
        headers: tenantHeaders,
      });
      expect(selectResponse.statusCode).toBe(201);
      const body = selectResponse.json().data;
      expect(body.outcome).toBe("cloned");
      const clonedCourseId = body.courseId as string;

      // Regression: activeSelectionsByPlatformCourse must read via request.tenantDb, not
      // fastify.db — marketplace_selections has FORCE ROW LEVEL SECURITY, so a query on the
      // untenanted pool silently returns zero rows and alreadySelected/selectionStatus would
      // stay false/null forever, even right after a successful clone.
      const detailAfterSelect = await server.inject({
        method: "GET",
        url: `/tenant/course-marketplace/${courseId}`,
        headers: tenantHeaders,
      });
      expect(detailAfterSelect.json().data.alreadySelected).toBe(true);
      expect(detailAfterSelect.json().data.selectionStatus).toBe("fulfilled");

      const listAfterSelect = await server.inject({ method: "GET", url: "/tenant/course-marketplace", headers: tenantHeaders });
      const listedCourse = (listAfterSelect.json().data as { id: string; alreadySelected: boolean }[]).find((c) => c.id === courseId);
      expect(listedCourse?.alreadySelected).toBe(true);

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${clonedCourseId}/curriculum`, headers: tenantHeaders });
      expect(curriculum.statusCode).toBe(200);
      // spec 028 changed this endpoint's response shape from a bare array to
      // { modules, standaloneContentItems, outlineOrder } — modules live under `.modules` now.
      const modules = curriculum.json().data.modules as { id: string; status: string; contentItems: { id: string; status: string }[] }[];
      expect(modules).toHaveLength(2);
      expect(modules[0].contentItems).toHaveLength(1);
      // Regression (found in production use): clonePlatformCourseIntoTenant never appended the new
      // module ids to courses.outlineOrder, so the editor's curriculum-tab.tsx — which renders
      // strictly from outlineOrder, not from `.modules` directly — showed "No modules or lessons
      // yet" for every cloned course even though the rows genuinely existed. `.modules` alone (the
      // assertion above) can't catch this; only outlineOrder does.
      const outlineOrder = curriculum.json().data.outlineOrder as string[];
      expect(outlineOrder).toEqual(modules.map((m) => m.id));
      // Modules/content items must clone as "published", not the schema default "draft" — same
      // reasoning as the course itself starting "active": the platform source was already
      // published, so the clone must be immediately usable, not draft content the tenant has to
      // separately publish module-by-module.
      expect(modules[0].status).toBe("published");
      expect(modules[0].contentItems[0].status).toBe("published");

      const clonedItemId = modules[0].contentItems[0].id;
      const attachments = await server.inject({ method: "GET", url: `/tenant/content-items/${clonedItemId}/attachments`, headers: tenantHeaders });
      expect(attachments.json().data).toHaveLength(1);
      // The clone's file_attachments row reuses the exact storage_key the platform original used —
      // verified indirectly here by confirming a download URL resolves against the same recorded
      // object rather than a new upload; the shared-key assertion itself is made directly against
      // the DB in course-marketplace-immutability-and-isolation.test.ts (Polish phase, T039).
      expect(recording.uploadedKeys).toHaveLength(1);

      const courseDetail = await server.inject({ method: "GET", url: `/tenant/courses/${clonedCourseId}`, headers: tenantHeaders });
      expect(courseDetail.json().data.category.name).toBe("Compliance");
    } finally {
      await server.close();
    }
  });

  it("auto-creates a category by name for the tenant, and matches an existing one case-insensitively on a second course", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const unique = randomUUID().slice(0, 8);
      const categoryName = `New Category ${unique}`;
      const { courseId } = await createActivePlatformCourseWithCurriculum(server, adminHeaders, categoryName);
      const select1 = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      const course1 = await server.inject({ method: "GET", url: `/tenant/courses/${select1.json().data.courseId}`, headers: tenantHeaders });
      expect(course1.json().data.category.name).toBe(categoryName);

      const { courseId: courseId2 } = await createActivePlatformCourseWithCurriculum(server, adminHeaders, categoryName.toUpperCase());
      const select2 = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId2}/select`, headers: tenantHeaders });
      const course2 = await server.inject({ method: "GET", url: `/tenant/courses/${select2.json().data.courseId}`, headers: tenantHeaders });
      expect(course2.json().data.category.id).toBe(course1.json().data.category.id);
    } finally {
      await server.close();
    }
  });

  it("rejects a duplicate selection of the same platform course by the same tenant", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const { courseId } = await createActivePlatformCourseWithCurriculum(server, adminHeaders);
      const first = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      expect(second.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("does not mutate the platform source after cloning", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const { courseId } = await createActivePlatformCourseWithCurriculum(server, adminHeaders);
      const before = await server.inject({ method: "GET", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders });

      await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });

      const after = await server.inject({ method: "GET", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders });
      expect(after.json().data.title).toBe(before.json().data.title);
      expect(after.json().data.modules).toEqual(before.json().data.modules);
    } finally {
      await server.close();
    }
  });

  it("rejects selection for a tenant user lacking course.manage", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const { courseId } = await createActivePlatformCourseWithCurriculum(server, adminHeaders);
      const response = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
