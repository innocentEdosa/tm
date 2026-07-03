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

describe("GET /platform/me — authenticated landing confirmation (US1)", () => {
  afterAll(async () => {
    await adminPool.end();
  });

  it("returns the account fields and isSuperAdminFlagSet: true for a freshly logged-in session", async () => {
    const server = await buildTestServer();
    const email = `me-confirmation-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    const passwordHash = await hashPassword(password);
    await adminPool.query(
      "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, 'Confirmation Admin')",
      [email, passwordHash],
    );

    const loginResponse = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email, password },
    });
    const cookieValue = extractCookieValue(loginResponse.headers["set-cookie"]);

    const meResponse = await server.inject({
      method: "GET",
      url: "/platform/me",
      headers: { cookie: `tm_super_admin_session=${cookieValue}` },
    });

    expect(meResponse.statusCode).toBe(200);
    const body = meResponse.json();
    expect(body.data.email).toBe(email);
    expect(body.data.name).toBe("Confirmation Admin");
    expect(body.data.isSuperAdminFlagSet).toBe(true);

    await server.close();
  });
});
