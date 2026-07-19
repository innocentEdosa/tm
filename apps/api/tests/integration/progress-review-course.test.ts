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

async function recordProgress(server: Awaited<ReturnType<typeof buildTestServer>>, headers: Headers, contentItemId: string, payload: Record<string, unknown>) {
  return server.inject({ method: "PUT", url: `/tenant/content-items/${contentItemId}/progress`, headers, payload });
}

describe("progress review course (spec US3, FR-011/FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("shows progress from multiple learners, identified by learner", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId, { fullName: "Manager One" });
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);
    const learnerAId = randomUUID();
    await seedUser(tenantId, learnerAId, { fullName: "Learner A" });
    await seedUserWithRole(tenantId, learnerAId, ["course.view"]);
    const learnerBId = randomUUID();
    await seedUser(tenantId, learnerBId, { fullName: "Learner B" });
    await seedUserWithRole(tenantId, learnerBId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const managerHeaders = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, managerHeaders);
      const module = await createModule(server, managerHeaders, course.id);
      const item = await createContentItem(server, managerHeaders, module.id);

      await recordProgress(server, { "x-test-user-id": learnerAId, "x-test-tenant-id": tenantId }, item.id, { status: "in_progress" });
      await recordProgress(server, { "x-test-user-id": learnerBId, "x-test-tenant-id": tenantId }, item.id, { status: "completed" });

      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/progress/learners`, headers: managerHeaders });
      expect(response.statusCode).toBe(200);
      const data = response.json().data as { learner: { id: string } }[];
      const learnerIds = data.map((d) => d.learner.id).sort();
      expect(learnerIds).toEqual([learnerAId, learnerBId].sort());
    } finally {
      await server.close();
    }
  });

  it("returns an empty array for a course nobody has recorded progress on", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, headers);

      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/progress/learners`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a cross-tenant courseId", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await seedUserWithRole(tenantId, managerId, ["course.manage"]);

    const otherTenantId = randomUUID();
    await seedTenant(otherTenantId);
    const otherManagerId = randomUUID();
    await seedUser(otherTenantId, otherManagerId);
    await seedUserWithRole(otherTenantId, otherManagerId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const otherHeaders = { "x-test-user-id": otherManagerId, "x-test-tenant-id": otherTenantId };
      const otherCourse = await createCourse(server, otherHeaders);

      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "GET", url: `/tenant/courses/${otherCourse.id}/progress/learners`, headers });
      expect(response.statusCode).toBe(404);
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

      const noPermHeaders = { "x-test-user-id": noPermId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}/progress/learners`, headers: noPermHeaders });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
