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

describe("progress record own (spec US1, FR-001..FR-007/FR-017)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("first write creates a row with enteredAt set", async () => {
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

      const response = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/progress`,
        headers,
        payload: { status: "in_progress", bookmark: "00:02:15", sessionTimeSeconds: 135 },
      });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.status).toBe("in_progress");
      expect(data.bookmark).toBe("00:02:15");
      expect(data.totalTimeSeconds).toBe(135);
      expect(data.enteredAt).not.toBeNull();
    } finally {
      await server.close();
    }
  });

  it("second write updates the same row in place, accumulating totalTimeSeconds, enteredAt unchanged", async () => {
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

      const first = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/progress`,
        headers,
        payload: { status: "in_progress", bookmark: "00:02:15", sessionTimeSeconds: 135 },
      });
      const enteredAt = first.json().data.enteredAt;

      const second = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/progress`,
        headers,
        payload: { status: "completed", bookmark: "00:10:00", sessionTimeSeconds: 465 },
      });
      expect(second.statusCode).toBe(200);
      const data = second.json().data;
      expect(data.status).toBe("completed");
      expect(data.bookmark).toBe("00:10:00");
      expect(data.totalTimeSeconds).toBe(600);
      expect(data.enteredAt).toBe(enteredAt);
    } finally {
      await server.close();
    }
  });

  it("omitting sessionTimeSeconds leaves totalTimeSeconds unchanged while status/bookmark still apply", async () => {
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

      await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/progress`,
        headers,
        payload: { status: "in_progress", sessionTimeSeconds: 100 },
      });

      const response = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/progress`,
        headers,
        payload: { status: "completed", bookmark: "final" },
      });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.status).toBe("completed");
      expect(data.bookmark).toBe("final");
      expect(data.totalTimeSeconds).toBe(100);
    } finally {
      await server.close();
    }
  });

  it("accepts a status regression without error (Clarifications Q1)", async () => {
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

      await server.inject({ method: "PUT", url: `/tenant/content-items/${item.id}/progress`, headers, payload: { status: "completed" } });
      const response = await server.inject({ method: "PUT", url: `/tenant/content-items/${item.id}/progress`, headers, payload: { status: "in_progress" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe("in_progress");
    } finally {
      await server.close();
    }
  });

  it("rejects an inconsistent score (scoreRaw outside [scoreMin, scoreMax])", async () => {
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

      const response = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/progress`,
        headers,
        payload: { status: "completed", scoreRaw: 150, scoreMin: 0, scoreMax: 100 },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects suspendData exceeding 4096 characters", async () => {
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

      const response = await server.inject({
        method: "PUT",
        url: `/tenant/content-items/${item.id}/progress`,
        headers,
        payload: { status: "in_progress", suspendData: "x".repeat(4097) },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects a missing or invalid status", async () => {
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

      const missing = await server.inject({ method: "PUT", url: `/tenant/content-items/${item.id}/progress`, headers, payload: {} });
      expect(missing.statusCode).toBe(400);

      const invalid = await server.inject({ method: "PUT", url: `/tenant/content-items/${item.id}/progress`, headers, payload: { status: "bogus" } });
      expect(invalid.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a cross-tenant or nonexistent contentItemId", async () => {
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
      const crossTenant = await server.inject({ method: "PUT", url: `/tenant/content-items/${otherItem.id}/progress`, headers, payload: { status: "in_progress" } });
      expect(crossTenant.statusCode).toBe(404);

      const nonexistent = await server.inject({ method: "PUT", url: `/tenant/content-items/${randomUUID()}/progress`, headers, payload: { status: "in_progress" } });
      expect(nonexistent.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a caller holding neither course.view nor course.manage", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);
    const noPermId = randomUUID();
    await seedUser(tenantId, noPermId);
    await seedUserWithRole(tenantId, noPermId, []);

    const server = await buildTestServer();
    try {
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, managerHeaders);
      const module = await createModule(server, managerHeaders, course.id);
      const item = await createContentItem(server, managerHeaders, module.id);

      const noPermHeaders = { "x-test-user-id": noPermId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "PUT", url: `/tenant/content-items/${item.id}/progress`, headers: noPermHeaders, payload: { status: "in_progress" } });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
