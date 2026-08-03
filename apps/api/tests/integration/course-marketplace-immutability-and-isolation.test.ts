import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function createActiveFreePlatformCourse(server: Server, adminHeaders: Headers) {
  const created = await server.inject({
    method: "POST",
    url: "/admin/platform-courses",
    headers: adminHeaders,
    payload: { title: `Course ${randomUUID()}`, categoryName: "Compliance", deliveryMode: "self_paced", duration: { value: 15, unit: "minutes" } },
  });
  const courseId = created.json().data.id as string;
  const module = await server.inject({ method: "POST", url: `/admin/platform-courses/${courseId}/modules`, headers: adminHeaders, payload: { title: "Module 1" } });
  const moduleId = module.json().data.id as string;
  await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { status: "active" } });
  return { courseId, moduleId };
}

async function seedTenantWithCourseManage(): Promise<{ headers: Headers; tenantId: string }> {
  const tenantId = randomUUID();
  await seedTenant(tenantId);
  const userId = randomUUID();
  await seedUser(tenantId, userId);
  await seedUserWithRole(tenantId, userId, ["course.manage"]);
  return { headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId }, tenantId };
}

describe("course marketplace immutability + cross-tenant isolation (spec 029 SC-007, Polish T038/T039)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("rejects editing a platform course's immutable fields once a tenant has cloned it, but metadata-only fields still edit", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId } = await createActiveFreePlatformCourse(server, adminHeaders);
      await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });

      const editTitle = await server.inject({
        method: "PATCH",
        url: `/admin/platform-courses/${courseId}`,
        headers: adminHeaders,
        payload: { title: "New Title" },
      });
      expect(editTitle.statusCode).toBe(409);

      const editDescription = await server.inject({
        method: "PATCH",
        url: `/admin/platform-courses/${courseId}`,
        headers: adminHeaders,
        payload: { description: "Still editable" },
      });
      expect(editDescription.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects module/content-item edit and delete once ≥1 fulfilled selection exists", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId, moduleId } = await createActiveFreePlatformCourse(server, adminHeaders);
      await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });

      const newModule = await server.inject({
        method: "POST",
        url: `/admin/platform-courses/${courseId}/modules`,
        headers: adminHeaders,
        payload: { title: "Should be blocked" },
      });
      expect(newModule.statusCode).toBe(409);

      const editModule = await server.inject({
        method: "PATCH",
        url: `/admin/platform-course-modules/${moduleId}`,
        headers: adminHeaders,
        payload: { title: "Renamed" },
      });
      expect(editModule.statusCode).toBe(409);

      const deleteModule = await server.inject({ method: "DELETE", url: `/admin/platform-course-modules/${moduleId}`, headers: adminHeaders });
      expect(deleteModule.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("a tenant's own marketplace_selections are invisible to a different tenant, but visible to the Super Admin queue", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantAHeaders } = await seedTenantWithCourseManage();
    const { headers: tenantBHeaders } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const created = await server.inject({
        method: "POST",
        url: "/admin/platform-courses",
        headers: adminHeaders,
        payload: { title: `Paid ${randomUUID()}`, categoryName: "Compliance", deliveryMode: "self_paced", duration: { value: 15, unit: "minutes" }, cost: 10 },
      });
      const courseId = created.json().data.id as string;
      await server.inject({ method: "PATCH", url: `/admin/platform-courses/${courseId}`, headers: adminHeaders, payload: { status: "active" } });

      const selectA = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantAHeaders });
      const selectionId = selectA.json().data.selectionId as string;

      const tenantASelections = await server.inject({ method: "GET", url: "/tenant/course-marketplace/selections", headers: tenantAHeaders });
      expect(tenantASelections.json().data.map((s: { id: string }) => s.id)).toContain(selectionId);

      const tenantBSelections = await server.inject({ method: "GET", url: "/tenant/course-marketplace/selections", headers: tenantBHeaders });
      expect(tenantBSelections.json().data.map((s: { id: string }) => s.id)).not.toContain(selectionId);

      const adminQueue = await server.inject({ method: "GET", url: "/admin/marketplace-selections", headers: adminHeaders });
      expect(adminQueue.json().data.map((s: { id: string }) => s.id)).toContain(selectionId);
    } finally {
      await server.close();
    }
  });

  it("a cloned content item's file_attachments row shares the exact storage_key of the platform original (SC-005)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const { headers: tenantHeaders, tenantId } = await seedTenantWithCourseManage();

    const server = await buildTestServer();
    try {
      const { courseId, moduleId } = await createActiveFreePlatformCourse(server, adminHeaders);
      const item = await server.inject({
        method: "POST",
        url: `/admin/platform-course-modules/${moduleId}/content-items`,
        headers: adminHeaders,
        payload: { type: "article", title: "With File", payload: { body: "x" } },
      });
      const itemId = item.json().data.id as string;

      const { RecordingStorageClient } = await import("../unit/fixtures/recording-storage-client");
      const { __setStorageClientForTesting } = await import("../../src/storage/storage");
      const { R2StorageClient } = await import("../../src/storage/r2-client");
      const recording = new RecordingStorageClient();
      __setStorageClientForTesting(recording);

      try {
        const upload = await server.inject({
          method: "POST",
          url: `/admin/platform-course-content-items/${itemId}/attachments`,
          headers: adminHeaders,
          payload: { fileName: "doc.pdf", contentType: "application/pdf", sizeBytes: 100 },
        });
        const attachmentId = upload.json().data.id as string;
        const platformStorageKey = recording.uploadedKeys[0].key;
        recording.simulateUpload(platformStorageKey, 100);
        await server.inject({
          method: "POST",
          url: `/admin/platform-file-attachments/${attachmentId}/confirm`,
          headers: adminHeaders,
        });

        const select = await server.inject({ method: "POST", url: `/tenant/course-marketplace/${courseId}/select`, headers: tenantHeaders });
        const clonedCourseId = select.json().data.courseId as string;
        const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${clonedCourseId}/curriculum`, headers: tenantHeaders });
        // spec 028 changed this endpoint's response shape from a bare array to
        // { modules, standaloneContentItems, outlineOrder } — modules live under `.modules` now.
        const clonedItemId = curriculum.json().data.modules[0].contentItems[0].id as string;

        const { withTenantTransaction } = await import("../helpers/pg");
        const rows = await withTenantTransaction(tenantId, async (client) => {
          const result = await client.query<{ storage_key: string }>(
            `SELECT storage_key FROM file_attachments WHERE entity_type = 'content_item' AND entity_id = $1`,
            [clonedItemId],
          );
          return result.rows;
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].storage_key).toBe(platformStorageKey);

        // No second object was ever uploaded for the clone — only the one platform-side PUT.
        expect(recording.uploadedKeys).toHaveLength(1);
      } finally {
        __setStorageClientForTesting(new R2StorageClient());
      }
    } finally {
      await server.close();
    }
  });
});
