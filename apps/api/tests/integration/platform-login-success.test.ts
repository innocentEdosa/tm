import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { hashPassword } from "../../src/platform-auth/password";

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seedSuperAdmin(email: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await adminPool.query(
    "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, 'Test Admin')",
    [email, passwordHash],
  );
}

describe("POST /platform/login — success (US1)", () => {
  afterAll(async () => {
    await adminPool.end();
  });

  it("returns 200 with a Set-Cookie header and the account fields, and updates last_login_at", async () => {
    const server = await buildTestServer();
    const email = `login-success-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    await seedSuperAdmin(email, password);

    const response = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toMatch(/^tm_super_admin_session=/);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(email);
    expect(body.data).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(body)).not.toContain(password);

    const row = await adminPool.query<{ last_login_at: Date | null }>(
      "SELECT last_login_at FROM super_admins WHERE email = $1",
      [email],
    );
    expect(row.rows[0].last_login_at).not.toBeNull();

    await server.close();
  });
});
