import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { userRoles } from "../../src/db/schema/roles";

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

async function createModule(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, courseId: string) {
  const response = await server.inject({ method: "POST", url: `/tenant/courses/${courseId}/modules`, headers, payload: { title: `Module ${randomUUID()}` } });
  return response.json().data as { id: string };
}

async function createContentItem(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, moduleId: string) {
  const response = await server.inject({
    method: "POST",
    url: `/tenant/modules/${moduleId}/content-items`,
    headers,
    payload: { type: "article", title: `Item ${randomUUID()}`, payload: { body: "text" } },
  });
  return response.json().data as { id: string };
}

async function recordProgress(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, contentItemId: string, payload: Record<string, unknown>) {
  return server.inject({ method: "PUT", url: `/tenant/content-items/${contentItemId}/progress`, headers, payload });
}

describe("progress read own (spec US2, FR-008/FR-009/FR-010)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("reads an existing row back with every field round-tripped", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createContentItem(server, headers, module.id);

      await recordProgress(server, headers, item.id, {
        status: "in_progress",
        bookmark: "00:05:00",
        suspendData: "abc",
        scoreRaw: 50,
        scoreMin: 0,
        scoreMax: 100,
        sessionTimeSeconds: 300,
      });

      const response = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/progress`, headers });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.status).toBe("in_progress");
      expect(data.bookmark).toBe("00:05:00");
      expect(data.suspendData).toBe("abc");
      expect(data.scoreRaw).toBe(50);
      expect(data.scoreMin).toBe(0);
      expect(data.scoreMax).toBe(100);
      expect(data.totalTimeSeconds).toBe(300);
    } finally {
      await server.close();
    }
  });

  it("returns a synthetic not-started result for an untouched content item, not 404", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createContentItem(server, headers, module.id);

      const response = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/progress`, headers });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.status).toBe("not_started");
      expect(data.enteredAt).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("reads whole-course progress ordered by curriculum position, only touched items present", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const moduleA = await createModule(server, headers, course.id);
      const moduleB = await createModule(server, headers, course.id);
      const itemA1 = await createContentItem(server, headers, moduleA.id);
      const itemA2 = await createContentItem(server, headers, moduleA.id);
      const itemB1 = await createContentItem(server, headers, moduleB.id);

      await recordProgress(server, headers, itemA2.id, { status: "completed" });
      await recordProgress(server, headers, itemB1.id, { status: "in_progress" });
      // itemA1 deliberately left untouched.

      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/progress`, headers });
      expect(response.statusCode).toBe(200);
      const data = response.json().data as { contentItemId: string }[];
      expect(data.map((d) => d.contentItemId)).toEqual([itemA2.id, itemB1.id]);
    } finally {
      await server.close();
    }
  });

  it("returns an empty array for a course the caller never touched", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/progress`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("self-read still succeeds after the caller's course.view is revoked (SC-005)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);
      const module = await createModule(server, headers, course.id);
      const item = await createContentItem(server, headers, module.id);
      await recordProgress(server, headers, item.id, { status: "in_progress" });

      await withTenantDb(tenantId, (db) => db.delete(userRoles).where(eq(userRoles.userId, userId)));

      const itemResponse = await server.inject({ method: "GET", url: `/tenant/content-items/${item.id}/progress`, headers });
      expect(itemResponse.statusCode).toBe(200);
      expect(itemResponse.json().data.status).toBe("in_progress");

      const courseResponse = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/progress`, headers });
      expect(courseResponse.statusCode).toBe(200);
      expect(courseResponse.json().data).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a cross-tenant contentItemId or courseId", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view", "course.manage"]);

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherUserId = randomUUID();
    await seedUser(otherTenantId, otherUserId);
    await seedUserWithRole(otherTenantId, otherUserId, ["course.view", "course.manage"]);

    const server = await buildTestServer();
    try {
      const otherHeaders = { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId };
      const otherCourse = await createCourse(server, otherHeaders);
      const otherModule = await createModule(server, otherHeaders, otherCourse.id);
      const otherItem = await createContentItem(server, otherHeaders, otherModule.id);

      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const itemResponse = await server.inject({ method: "GET", url: `/tenant/content-items/${otherItem.id}/progress`, headers });
      expect(itemResponse.statusCode).toBe(404);

      const courseResponse = await server.inject({ method: "GET", url: `/tenant/courses/${otherCourse.id}/progress`, headers });
      expect(courseResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
