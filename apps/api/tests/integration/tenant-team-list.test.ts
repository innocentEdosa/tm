import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("GET /tenant/team — org-wide directory (spec 012 US1, FR-002/FR-004/FR-008/FR-012)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns every member across every department for a team.view.all holder, with correct fields", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUserWithRole(tenantId, viewerId, ["team.view.all"]);
    const { roleId } = await seedRole(tenantId, "Content Reviewer");

    const { deptA, deptB, memberA, memberB } = await withTenantDb(tenantId, async (db) => {
      const [deptA] = await db.insert(departments).values({ tenantId, name: `Dept A ${randomUUID()}` }).returning({ id: departments.id });
      const [deptB] = await db.insert(departments).values({ tenantId, name: `Dept B ${randomUUID()}` }).returning({ id: departments.id });
      const [memberA] = await db
        .insert(users)
        .values({ tenantId, fullName: "Alice Anderson", email: `alice-${randomUUID()}@example.com`, departmentId: deptA.id })
        .returning({ id: users.id });
      const [memberB] = await db
        .insert(users)
        .values({ tenantId, fullName: "Bob Brown", email: `bob-${randomUUID()}@example.com`, departmentId: deptB.id, mustChangePassword: true })
        .returning({ id: users.id });
      return { deptA, deptB, memberA, memberB };
    });
    await seedUserWithRole(tenantId, memberA.id, []);
    await withTenantDb(tenantId, async (db) => {
      await db.insert(userRoles).values({ tenantId, userId: memberB.id, roleId });
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const ids = body.data.map((m: { id: string }) => m.id);
      expect(ids).toEqual(expect.arrayContaining([memberA.id, memberB.id]));

      const bob = body.data.find((m: { id: string }) => m.id === memberB.id);
      expect(bob).toMatchObject({
        fullName: "Bob Brown",
        roleName: "Content Reviewer",
        accountStatus: "invited",
      });
      expect(bob.departmentName).toBeTruthy();

      const alice = body.data.find((m: { id: string }) => m.id === memberA.id);
      expect(alice.accountStatus).toBe("active");
    } finally {
      await server.close();
    }
  });

  it("narrows results server-side by name or email, case-insensitively", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUserWithRole(tenantId, viewerId, ["team.view.all"]);

    const unique = randomUUID();
    const { zeldaId, elseId } = await withTenantDb(tenantId, async (db) => {
      const [zelda] = await db
        .insert(users)
        .values({ tenantId, fullName: `Zelda Uniquename${unique}`, email: `zelda-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [elseUser] = await db
        .insert(users)
        .values({ tenantId, fullName: "Someone Else", email: `someone-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      return { zeldaId: zelda.id, elseId: elseUser.id };
    });
    await seedUserWithRole(tenantId, zeldaId, []);
    await seedUserWithRole(tenantId, elseId, []);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenant/team?search=${encodeURIComponent(`uniquename${unique}`.toLowerCase())}`,
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].fullName).toContain(unique);
    } finally {
      await server.close();
    }
  });

  it("paginates server-side and reports the correct total", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUserWithRole(tenantId, viewerId, ["team.view.all"]);

    const memberIds = await withTenantDb(tenantId, async (db) => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const [member] = await db
          .insert(users)
          .values({ tenantId, fullName: `Page Member ${i}`, email: `page-${i}-${randomUUID()}@example.com` })
          .returning({ id: users.id });
        ids.push(member.id);
      }
      return ids;
    });
    for (const id of memberIds) {
      await seedUserWithRole(tenantId, id, []);
    }

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team?page=1&pageSize=2",
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    } finally {
      await server.close();
    }
  });
});
