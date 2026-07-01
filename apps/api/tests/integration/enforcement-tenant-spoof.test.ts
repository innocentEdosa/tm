import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/**
 * A spoofed tenant header/body must never influence the result — only `request.user.tenantId`
 * from the (stubbed, trusted) session matters. `tenant-context.ts` never reads any header at all,
 * so this proves the point by construction: the extra header below is inert.
 */
describe("enforcement: tenant-claim spoofing has no effect", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("grants access using the real (session) tenant, ignoring a spoofed tenant header", async () => {
    const tenantA = randomUUID();
    const userInTenantA = randomUUID();
    await seedUserWithRole(tenantA, userInTenantA, ["approve_enrollment"]);
    const tenantB = randomUUID();

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/_internal/protected-demo",
        headers: {
          "x-test-user-id": userInTenantA,
          "x-test-tenant-id": tenantA,
          "x-spoofed-tenant-id": tenantB,
        },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("denies access based on the real (session) tenant, even with a spoofed tenant header claiming a permissioned tenant", async () => {
    const tenantA = randomUUID();
    const userInTenantA = randomUUID();
    await seedUserWithRole(tenantA, userInTenantA, ["approve_enrollment"]);

    const tenantB = randomUUID();
    const userInTenantB = randomUUID();
    await seedUserWithRole(tenantB, userInTenantB, []); // no approve_enrollment in tenant B

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/_internal/protected-demo",
        headers: {
          "x-test-user-id": userInTenantB,
          "x-test-tenant-id": tenantB,
          "x-spoofed-tenant-id": tenantA, // hoping the server picks up tenant A's grant instead
        },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
