import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

type Headers = Record<string, string>;

async function createCourse(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers) {
  const response = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers,
    payload: { title: `Course ${randomUUID()}`, category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
  });
  return response.json().data as { id: string };
}

async function createModule(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, courseId: string, title = `Module ${randomUUID()}`) {
  const response = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title } });
  return response.json().data as { id: string };
}

async function createItem(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, moduleId: string, title = `Item ${randomUUID()}`) {
  const response = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "article", title, payload: { body: "text" } },
  });
  return response.json().data as { id: string };
}

describe("edit, reorder, and move (spec US4, FR-006/FR-007/FR-008/FR-011)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("updates a module's and a content item's fields, refreshing audit fields", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createItem(server, headers, module.id);

      const moduleUpdate = await server.inject({ method: "PATCH", url: `/tenant/modules/${module.id}`, headers, payload: { title: "Renamed Module" } });
      expect(moduleUpdate.statusCode).toBe(200);
      expect(moduleUpdate.json().data.title).toBe("Renamed Module");
      expect(moduleUpdate.json().data.updatedBy.id).toBe(userId);

      const itemUpdate = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers, payload: { title: "Renamed Item" } });
      expect(itemUpdate.statusCode).toBe(200);
      expect(itemUpdate.json().data.title).toBe("Renamed Item");
    } finally {
      await server.close();
    }
  });

  it("rejects a type-change attempt and an invalid payload for the item's existing type", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createItem(server, headers, module.id);

      const typeChange = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers, payload: { type: "video" } });
      expect(typeChange.statusCode).toBe(422);

      const badPayload = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers, payload: { payload: {} } });
      expect(badPayload.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("reorders a course's modules and a module's content items, reflected on the next read", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const modA = await createModule(server, headers, course.id, "A");
      const modB = await createModule(server, headers, course.id, "B");
      const modC = await createModule(server, headers, course.id, "C");

      const reorderModules = await server.inject({
        method: "POST",
        url: `/tenant/courses/${course.id}/modules/reorder`,
        headers,
        payload: { moduleIds: [modC.id, modA.id, modB.id] },
      });
      expect(reorderModules.statusCode).toBe(200);

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      expect(curriculum.json().data.map((m: { title: string }) => m.title)).toEqual(["C", "A", "B"]);

      const item1 = await createItem(server, headers, modA.id, "1");
      const item2 = await createItem(server, headers, modA.id, "2");

      const reorderItems = await server.inject({
        method: "POST",
        url: `/tenant/modules/${modA.id}/content-items/reorder`,
        headers,
        payload: { contentItemIds: [item2.id, item1.id] },
      });
      expect(reorderItems.statusCode).toBe(200);

      const curriculum2 = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      const modAResult = curriculum2.json().data.find((m: { title: string }) => m.title === "A");
      expect(modAResult.contentItems.map((i: { title: string }) => i.title)).toEqual(["2", "1"]);
    } finally {
      await server.close();
    }
  });

  it("rejects a reorder whose id set doesn't exactly match the current set", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      await createModule(server, headers, course.id, "A");
      await createModule(server, headers, course.id, "B");

      const missingId = await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules/reorder`, headers, payload: { moduleIds: [randomUUID()] } });
      expect(missingId.statusCode).toBe(422);

      const emptyList = await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules/reorder`, headers, payload: { moduleIds: [] } });
      expect(emptyList.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("moves a content item to a different module in the same course, appended last; rejects a move to a module in a different course", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const modA = await createModule(server, headers, course.id, "A");
      const modB = await createModule(server, headers, course.id, "B");
      const item = await createItem(server, headers, modA.id, "Movable");
      await createItem(server, headers, modB.id, "Existing");

      const move = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers, payload: { moduleId: modB.id } });
      expect(move.statusCode).toBe(200);

      const curriculum = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/curriculum`, headers });
      const data = curriculum.json().data;
      const resultModA = data.find((m: { title: string }) => m.title === "A");
      const resultModB = data.find((m: { title: string }) => m.title === "B");
      expect(resultModA.contentItems).toHaveLength(0);
      expect(resultModB.contentItems.map((i: { title: string }) => i.title)).toEqual(["Existing", "Movable"]);

      const otherCourse = await createCourse(server, headers);
      const otherModule = await createModule(server, headers, otherCourse.id, "Other Course Module");
      const crossCourseMove = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers, payload: { moduleId: otherModule.id } });
      expect(crossCourseMove.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting any edit, reorder, or move", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);
    const viewerId = randomUUID();
    await seedUser(tenantId, viewerId);
    await seedUserWithRole(tenantId, viewerId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, managerHeaders);
      const module = await createModule(server, managerHeaders, course.id);
      const item = await createItem(server, managerHeaders, module.id);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const moduleEdit = await server.inject({ method: "PATCH", url: `/tenant/modules/${module.id}`, headers: viewerHeaders, payload: { title: "Nope" } });
      expect(moduleEdit.statusCode).toBe(403);

      const itemEdit = await server.inject({ method: "PATCH", url: `/tenant/content-items/${item.id}`, headers: viewerHeaders, payload: { title: "Nope" } });
      expect(itemEdit.statusCode).toBe(403);

      const reorder = await server.inject({ method: "POST", url: `/tenant/courses/${course.id}/modules/reorder`, headers: viewerHeaders, payload: { moduleIds: [module.id] } });
      expect(reorder.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
