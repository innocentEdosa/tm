import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { hashPassword } from "../../src/platform-auth/password";

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

function extractCookieValue(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = header?.match(/^tm_super_admin_session=([^;]+)/);
  if (!match) throw new Error("No session cookie in response");
  return match[1];
}

/**
 * Proves the "vice versa" direction of FR-007 holds via Spec 1's existing, unmodified
 * `requirePermission` logic — zero changes to Spec 1's code were needed (research.md §4): a Super
 * Admin session cookie never populates `request.user`, so a tenant-scoped guard sees no user at all
 * and denies by default, exactly as it already does for any unauthenticated request.
 */
describe("Tenant-scoped route rejects a Super Admin session (US2, Acceptance Scenario 2)", () => {
  afterAll(async () => {
    await adminPool.end();
  });

  it("POST /_internal/protected-demo returns 403 with only a Super Admin cookie (no dev-stub headers)", async () => {
    const server = await buildTestServer();
    const email = `vice-versa-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    const passwordHash = await hashPassword(password);
    await adminPool.query(
      "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, 'Vice Versa Admin')",
      [email, passwordHash],
    );

    const loginResponse = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email, password },
    });
    const cookieValue = extractCookieValue(loginResponse.headers["set-cookie"]);

    const response = await server.inject({
      method: "POST",
      url: "/_internal/protected-demo",
      headers: { cookie: `tm_super_admin_session=${cookieValue}` },
    });

    expect(response.statusCode).toBe(403);
    await server.close();
  });
});
