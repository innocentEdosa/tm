import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";

describe("PATCH /tenant/team/:userId — permission gating (spec 013 US2, FR-007)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedMember(tenantId: string) {
    const { roleId } = await seedRole(tenantId, "Employee", []);
    return withTenantDb(tenantId, async (db) => {
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Member", email: `member-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId });
      return member.id;
    });
  }

  it("returns 403 for a caller holding only a team-viewing permission", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUserWithRole(tenantId, viewerId, ["team.view.all"]);
    const memberId = await seedMember(tenantId);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
        payload: { fullName: "Attempted Edit" },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("returns 200 for a caller holding team.edit, and for one holding manage_team_members", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await seedUserWithRole(tenantId, editorId, ["team.edit"]);
    const managerId = randomUUID();
    await seedUserWithRole(tenantId, managerId, ["manage_team_members"]);
    const memberId = await seedMember(tenantId);

    const server = await buildTestServer();
    try {
      const viaTeamEdit = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { fullName: "Edited By Team Edit" },
      });
      expect(viaTeamEdit.statusCode).toBe(200);

      const viaManageTeamMembers = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": managerId, "x-test-tenant-id": tenantId },
        payload: { fullName: "Edited By Manage Team Members" },
      });
      expect(viaManageTeamMembers.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("returns 404 for a userId that doesn't exist in the caller's tenant", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await seedUserWithRole(tenantId, editorId, ["team.edit"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${randomUUID()}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { fullName: "Nobody" },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
