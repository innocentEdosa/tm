import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { users } from "../../src/db/schema/users";
import { userRoles, roles } from "../../src/db/schema/roles";

describe("GET /tenant/team — invite metadata (spec 012 US4, FR-006)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("includes invitedByName/invitedAt, resolved via the inviter self-join", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUserWithRole(tenantId, viewerId, ["team.view.all"]);

    const { memberId } = await withTenantDb(tenantId, async (db) => {
      const [inviter] = await db
        .insert(users)
        .values({ tenantId, fullName: "Inviting Admin", email: `inviter-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [role] = await db.insert(roles).values({ tenantId, name: `Role ${randomUUID()}` }).returning({ id: roles.id });
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Invited Member", email: `member-${randomUUID()}@example.com`, invitedBy: inviter.id })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId: role.id });
      return { memberId: member.id };
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const member = response.json().data.find((m: { id: string }) => m.id === memberId);
      expect(member.invitedByName).toBe("Inviting Admin");
      expect(member.invitedAt).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("returns invitedByName: null for a member with no recorded inviter, without erroring", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const viewerId = randomUUID();
    await seedUserWithRole(tenantId, viewerId, ["team.view.all"]);

    await withTenantDb(tenantId, async (db) => {
      const [role] = await db.insert(roles).values({ tenantId, name: `Role ${randomUUID()}` }).returning({ id: roles.id });
      const [member] = await db
        .insert(users)
        .values({ tenantId, fullName: "Pre-Existing Member", email: `pre-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: member.id, roleId: role.id });
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId },
      });
      expect(response.statusCode).toBe(200);
      const member = response.json().data.find((m: { fullName: string }) => m.fullName === "Pre-Existing Member");
      expect(member.invitedByName).toBeNull();
    } finally {
      await server.close();
    }
  });
});
