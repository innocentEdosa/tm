import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getTestPool, closeTestPool } from "../helpers/pg";
import { buildTestServer } from "../helpers/test-server";
import { hashSessionToken } from "../../src/platform-auth/session";
import { requireSuperAdminSession } from "../../src/platform-auth/require-super-admin-session";

// tm_app (getTestPool) has no INSERT grant on super_admins by design (research.md §7) — seeding a
// row for tests needs the migration/owner role instead.
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Proves the super-admin-context plugin + guard in isolation from the real login/session routes
 * (which land in later phases) — mirrors Spec 1/2's precedent of proving foundational mechanisms via
 * raw fixtures ahead of any business route depending on them.
 */
describe("super-admin-context mechanism", () => {
  afterAll(async () => {
    await adminPool.end();
    await closeTestPool();
  });

  async function seedSuperAdmin(): Promise<string> {
    const result = await adminPool.query<{ id: string }>(
      `INSERT INTO super_admins (email, password_hash, name) VALUES ($1, 'irrelevant', 'Test Admin')
       RETURNING id`,
      [`super-admin-${randomUUID()}@example.com`],
    );
    return result.rows[0].id;
  }

  async function seedSession(
    superAdminId: string,
    options: { expiresInMs: number; revoked?: boolean },
  ): Promise<string> {
    const token = randomUUID();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + options.expiresInMs);
    await getTestPool().query(
      `INSERT INTO super_admin_sessions (super_admin_id, token_hash, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4)`,
      [superAdminId, tokenHash, expiresAt, options.revoked ? new Date() : null],
    );
    return token;
  }

  it("sets app.is_super_admin for a valid session and rejects missing/expired/revoked/malformed ones", async () => {
    const server = await buildTestServer();
    server.get(
      "/_test/is-super-admin-flag",
      { preHandler: [requireSuperAdminSession] },
      async (request) => {
        const result = await request.superAdminDb!.execute(
          sql`SELECT current_setting('app.is_super_admin', true) AS flag`,
        );
        return { flag: (result.rows[0] as { flag: string }).flag };
      },
    );

    const superAdminId = await seedSuperAdmin();
    const validToken = await seedSession(superAdminId, { expiresInMs: 60_000 });
    const expiredToken = await seedSession(superAdminId, { expiresInMs: -60_000 });
    const revokedToken = await seedSession(superAdminId, { expiresInMs: 60_000, revoked: true });

    const validResponse = await server.inject({
      method: "GET",
      url: "/_test/is-super-admin-flag",
      headers: { cookie: `tm_super_admin_session=${validToken}` },
    });
    expect(validResponse.statusCode).toBe(200);
    expect(validResponse.json().flag).toBe("true");

    const expiredResponse = await server.inject({
      method: "GET",
      url: "/_test/is-super-admin-flag",
      headers: { cookie: `tm_super_admin_session=${expiredToken}` },
    });
    expect(expiredResponse.statusCode).toBe(401);

    const revokedResponse = await server.inject({
      method: "GET",
      url: "/_test/is-super-admin-flag",
      headers: { cookie: `tm_super_admin_session=${revokedToken}` },
    });
    expect(revokedResponse.statusCode).toBe(401);

    const missingResponse = await server.inject({ method: "GET", url: "/_test/is-super-admin-flag" });
    expect(missingResponse.statusCode).toBe(401);

    const malformedResponse = await server.inject({
      method: "GET",
      url: "/_test/is-super-admin-flag",
      headers: { cookie: "tm_super_admin_session=not-a-real-token" },
    });
    expect(malformedResponse.statusCode).toBe(401);

    await server.close();
  });
});
