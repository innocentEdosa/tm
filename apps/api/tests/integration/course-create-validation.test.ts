import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

describe("course create + validation (spec US1, FR-001/FR-001a-c/FR-008/FR-010)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a course with all required fields, defaulting to draft with audit fields set", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: {
          title: "Workplace Communication Essentials",
          category: "Soft Skills",
          deliveryMode: "virtual",
          duration: { value: 90, unit: "minutes" },
          provider: "Acme Learning Co.",
          cost: 49.99,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.status).toBe("draft");
      expect(body.data.category.name).toBe("Soft Skills");
      expect(body.data.createdBy.id).toBe(userId);
      expect(body.data.cost).toBe(49.99);
    } finally {
      await server.close();
    }
  });

  it("rejects a create request missing a required field", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid deliveryMode and an invalid duration.unit", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const badMode = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "X", category: "Technical", deliveryMode: "carrier_pigeon", duration: { value: 1, unit: "hours" } },
      });
      expect(badMode.statusCode).toBe(422);

      const badUnit = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "X", category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "fortnights" } },
      });
      expect(badUnit.statusCode).toBe(422);

      const negativeCost = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: {
          title: "X",
          category: "Technical",
          deliveryMode: "virtual",
          duration: { value: 1, unit: "hours" },
          cost: -5,
        },
      });
      expect(negativeCost.statusCode).toBe(422);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to create", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const response = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: { title: "X", category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("auto-creates a category that doesn't yet exist for the tenant, and dedupes case-insensitively", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const created = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: {
          title: "Advanced Rigging Safety",
          category: "Field Operations",
          deliveryMode: "in_person",
          duration: { value: 1, unit: "days" },
        },
      });
      expect(created.statusCode).toBe(201);

      const categories = await server.inject({ method: "GET", url: "/tenant/courses/categories", headers });
      const names = categories.json().data.map((c: { name: string }) => c.name);
      expect(names).toContain("Field Operations");
      const fieldOpsCount = names.filter((n: string) => n === "Field Operations").length;
      expect(fieldOpsCount).toBe(1);

      // Different casing on an existing category resolves to the same row, no duplicate.
      const second = await server.inject({
        method: "POST",
        url: "/tenant/courses",
        headers,
        payload: {
          title: "Rigging Refresher",
          category: "field operations",
          deliveryMode: "in_person",
          duration: { value: 2, unit: "hours" },
        },
      });
      expect(second.statusCode).toBe(201);
      expect(second.json().data.category.name).toBe("Field Operations");

      const categoriesAfter = await server.inject({ method: "GET", url: "/tenant/courses/categories", headers });
      const namesAfter = categoriesAfter.json().data.map((c: { name: string }) => c.name);
      expect(namesAfter.filter((n: string) => n === "Field Operations").length).toBe(1);
    } finally {
      await server.close();
    }
  });
});
