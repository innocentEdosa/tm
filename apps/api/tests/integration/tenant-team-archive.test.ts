import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { userRoles } from "../../src/db/schema/roles";
import { hashPassword } from "../../src/platform-auth/password";

describe("Archive capability (spec 013, HR feedback round)", () => {
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

  it("archiving sets archivedAt, hides the member from the default directory, and un-archiving restores it", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: editorId, tenantId, fullName: "Editor", email: `editor-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, editorId, ["team.edit", "team.view.all"]);
    const memberId = await seedMember(tenantId);

    const server = await buildTestServer();
    try {
      const archiveResponse = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { archived: true },
      });
      expect(archiveResponse.statusCode).toBe(200);

      const defaultList = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
      });
      expect(defaultList.json().data.map((m: { id: string }) => m.id)).not.toContain(memberId);

      const includeArchivedList = await server.inject({
        method: "GET",
        url: "/tenant/team?includeArchived=true",
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
      });
      const archivedRow = includeArchivedList.json().data.find((m: { id: string }) => m.id === memberId);
      expect(archivedRow).toBeTruthy();
      expect(archivedRow.isArchived).toBe(true);

      const unarchiveResponse = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${memberId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { archived: false },
      });
      expect(unarchiveResponse.statusCode).toBe(200);

      const restoredList = await server.inject({
        method: "GET",
        url: "/tenant/team",
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
      });
      expect(restoredList.json().data.map((m: { id: string }) => m.id)).toContain(memberId);
    } finally {
      await server.close();
    }
  });

  it("blocks archiving a department's Manager or Assistant Manager", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: editorId, tenantId, fullName: "Editor", email: `editor-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, editorId, ["team.edit"]);
    const { roleId } = await seedRole(tenantId, "Employee", []);

    const managerId = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager Person", email: `manager-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      await db.insert(userRoles).values({ tenantId, userId: manager.id, roleId });
      await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id });
      return manager.id;
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${managerId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { archived: true },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        success: false,
        message: expect.stringContaining("Manager"),
      });

      const stillActive = await withTenantDb(tenantId, async (db) => {
        const [row] = await db.select({ archivedAt: users.archivedAt }).from(users).where(eq(users.id, managerId));
        return row.archivedAt;
      });
      expect(stillActive).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("blocks a caller from archiving their own account", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const editorId = randomUUID();
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({ id: editorId, tenantId, fullName: "Editor", email: `editor-${randomUUID()}@example.com` });
    });
    await seedUserWithRole(tenantId, editorId, ["team.edit"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/tenant/team/${editorId}`,
        headers: { "x-test-user-id": editorId, "x-test-tenant-id": tenantId },
        payload: { archived: true },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ success: false, message: expect.stringContaining("own account") });
    } finally {
      await server.close();
    }
  });

  it("an archived account cannot log in", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const subdomain = `test-${tenantId}`;
    const email = `archived-${randomUUID()}@example.com`;
    await withTenantDb(tenantId, async (db) => {
      await db.insert(users).values({
        tenantId,
        fullName: "Archived Person",
        email,
        passwordHash: await hashPassword("Password123!"),
        mustChangePassword: false,
        archivedAt: new Date(),
      });
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenant-auth/login?subdomain=${subdomain}`,
        payload: { email, password: "Password123!" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ success: false, message: expect.stringContaining("archived") });
    } finally {
      await server.close();
    }
  });
});
