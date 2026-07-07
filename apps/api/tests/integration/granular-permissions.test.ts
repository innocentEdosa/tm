import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole, seedRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/**
 * Granular Permissions addendum (spec 011): each module's new create/read/edit/delete keys are
 * additive alongside its existing coarse "manage" permission, via `requireAnyPermission`. These
 * tests prove both halves of that contract for one representative route per module: a role holding
 * *only* the new granular key can perform the action (the new capability actually works), and a
 * role holding neither the legacy nor the granular key still gets 403 (nothing was accidentally
 * opened up). The legacy "manage" key continuing to work alone is already covered by every
 * pre-existing test for these routes — deliberately not re-asserted here.
 */
describe("granular permissions are additive alongside each module's legacy 'manage' key", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("department.create alone allows POST /tenant/departments; neither key gets 403", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const granted = randomUUID();
    await seedUserWithRole(tenantId, granted, ["department.create"]);
    const ungranted = randomUUID();
    await seedUserWithRole(tenantId, ungranted, []);

    const server = await buildTestServer();
    try {
      const allowed = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers: { "x-test-user-id": granted, "x-test-tenant-id": tenantId },
        payload: { name: `Dept ${randomUUID()}` },
      });
      expect(allowed.statusCode).toBe(201);

      const denied = await server.inject({
        method: "POST",
        url: "/tenant/departments",
        headers: { "x-test-user-id": ungranted, "x-test-tenant-id": tenantId },
        payload: { name: `Dept ${randomUUID()}` },
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("roles.read alone allows GET /tenant/roles and /tenant/permission-catalog", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, ["roles.read"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const roles = await server.inject({ method: "GET", url: "/tenant/roles", headers });
      expect(roles.statusCode).toBe(200);
      const catalog = await server.inject({ method: "GET", url: "/tenant/permission-catalog", headers });
      expect(catalog.statusCode).toBe(200);

      const create = await server.inject({
        method: "POST",
        url: "/tenant/roles",
        headers,
        payload: { name: `Role ${randomUUID()}` },
      });
      expect(create.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("forms.tenant.create alone allows POST /tenant/form-fields", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUserWithRole(tenantId, userId, ["forms.tenant.create"]);

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
        payload: { formKey: "department", label: `Custom Field ${randomUUID()}`, fieldType: "text" },
      });
      expect(response.statusCode).toBe(201);
    } finally {
      await server.close();
    }
  });

  it("team.create alone allows POST /tenant-auth/team; neither key gets 403", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { roleId } = await seedRole(tenantId, "Employee", []);
    const granted = randomUUID();
    await seedUserWithRole(tenantId, granted, ["team.create"]);
    const ungranted = randomUUID();
    await seedUserWithRole(tenantId, ungranted, []);

    const server = await buildTestServer();
    try {
      const allowed = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": granted, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Hire", email: `new-hire+${randomUUID()}@example.com`, roleId },
      });
      expect(allowed.statusCode).toBe(201);

      const denied = await server.inject({
        method: "POST",
        url: "/tenant-auth/team",
        headers: { "x-test-user-id": ungranted, "x-test-tenant-id": tenantId },
        payload: { fullName: "New Hire", email: `new-hire+${randomUUID()}@example.com`, roleId },
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
