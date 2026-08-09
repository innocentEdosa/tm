import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedRole, assignRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function seedDepartment(tenantId: string, name: string): Promise<string> {
  return withTenantDb(tenantId, async (db) => {
    const [d] = await db.insert(departments).values({ tenantId, name }).returning({ id: departments.id });
    return d.id;
  });
}

async function seedUserInDepartment(tenantId: string, userId: string, departmentId: string, fullName = "Dept User"): Promise<void> {
  await withTenantDb(tenantId, async (db) => {
    await db.insert(users).values({ id: userId, tenantId, fullName, email: `${userId}@example.com`, departmentId });
  });
}

async function preview(server: Server, headers: Headers, body: Record<string, unknown>) {
  return server.inject({ method: "POST", url: "/tenant/course-assignments/audience-preview", headers, payload: body });
}

describe("Course Assignment audience-preview (dedup learner count)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("mode 'all' returns the total number of tenant users", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    const otherId = randomUUID();
    await seedUser(tenantId, otherId);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const response = await preview(server, headers, { mode: "all" });
      expect(response.statusCode).toBe(200);
      // adminId + otherId = 2 (seedUserWithRole doesn't create an extra user row for admin).
      expect(response.json().data.totalLearners).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("mode 'selected' with only individual users counts exactly those users", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    const u1 = randomUUID();
    await seedUser(tenantId, u1);
    const u2 = randomUUID();
    await seedUser(tenantId, u2);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const response = await preview(server, headers, { mode: "selected", userIds: [u1, u2] });
      expect(response.json().data.totalLearners).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("does not double-count a user who is both individually selected and in a selected department", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const salesId = await seedDepartment(tenantId, "Sales");
    const john = randomUUID();
    await seedUserInDepartment(tenantId, john, salesId, "John Doe");
    const jane = randomUUID();
    await seedUserInDepartment(tenantId, jane, salesId, "Jane Smith");

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      // Sales has 2 members; John is ALSO individually selected — total must still be 2, not 3.
      const response = await preview(server, headers, { mode: "selected", departmentIds: [salesId], userIds: [john] });
      expect(response.json().data.totalLearners).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("does not double-count a user who belongs to two selected departments", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const salesId = await seedDepartment(tenantId, "Sales");
    const engId = await seedDepartment(tenantId, "Engineering");
    // A user can only belong to one department in this schema (users.department_id is singular), so
    // "two selected departments" overlap is exercised via role+department instead below; here we just
    // confirm two disjoint departments sum correctly (no accidental over/under count).
    const salesUser = randomUUID();
    await seedUserInDepartment(tenantId, salesUser, salesId, "Sales User");
    const engUser = randomUUID();
    await seedUserInDepartment(tenantId, engUser, engId, "Eng User");

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const response = await preview(server, headers, { mode: "selected", departmentIds: [salesId, engId] });
      expect(response.json().data.totalLearners).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("does not double-count a user reachable through both a selected department and a selected role", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const engId = await seedDepartment(tenantId, "Engineering");
    const { roleId: managerRoleId } = await seedRole(tenantId, "Manager");
    const dualUser = randomUUID();
    await seedUserInDepartment(tenantId, dualUser, engId, "Dual Path User");
    await assignRole(tenantId, dualUser, managerRoleId);
    const engOnlyUser = randomUUID();
    await seedUserInDepartment(tenantId, engOnlyUser, engId, "Eng Only");

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      // Engineering = 2 members (dualUser, engOnlyUser); Manager role = 1 member (dualUser, overlapping).
      // Union must be 2, not 3.
      const response = await preview(server, headers, { mode: "selected", departmentIds: [engId], roleIds: [managerRoleId] });
      expect(response.json().data.totalLearners).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("returns 0 for an empty selection", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const response = await preview(server, headers, { mode: "selected", userIds: [], departmentIds: [], roleIds: [] });
      expect(response.json().data.totalLearners).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a caller without course.manage", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUser(tenantId, viewerId);
    await seedUserWithRole(tenantId, viewerId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const response = await preview(server, headers, { mode: "all" });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("GET /tenant/users supports pagination with no search (browse-all for the audience builder)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId, { fullName: "Admin Zero" });
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    for (let i = 0; i < 3; i++) {
      await seedUser(tenantId, randomUUID(), { fullName: `Browse User ${i}` });
    }

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const response = await server.inject({ method: "GET", url: "/tenant/users?page=1&pageSize=2", headers });
      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(2);
      expect(json.pagination).toEqual({ page: 1, pageSize: 2, total: 4 });
    } finally {
      await server.close();
    }
  });
});
