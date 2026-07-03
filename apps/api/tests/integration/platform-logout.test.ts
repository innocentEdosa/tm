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

describe("POST /platform/logout — revokes the session (FR-011)", () => {
  afterAll(async () => {
    await adminPool.end();
  });

  it("returns 204 and a subsequent GET /platform/me with the same cookie returns 401", async () => {
    const server = await buildTestServer();
    const email = `logout-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    const passwordHash = await hashPassword(password);
    await adminPool.query(
      "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, 'Logout Admin')",
      [email, passwordHash],
    );

    const loginResponse = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email, password },
    });
    const cookieValue = extractCookieValue(loginResponse.headers["set-cookie"]);
    const cookieHeader = `tm_super_admin_session=${cookieValue}`;

    const logoutResponse = await server.inject({
      method: "POST",
      url: "/platform/logout",
      headers: { cookie: cookieHeader },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const meResponse = await server.inject({
      method: "GET",
      url: "/platform/me",
      headers: { cookie: cookieHeader },
    });
    expect(meResponse.statusCode).toBe(401);

    await server.close();
  });
});
