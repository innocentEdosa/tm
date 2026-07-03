import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { hashPassword } from "../../src/platform-auth/password";

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

describe("POST /platform/login — rate limiting (FR-009, SC-004)", () => {
  afterAll(async () => {
    await adminPool.end();
  });

  it("locks out after 5 consecutive failures, refuses even the correct password until cool-down, then resets on success", async () => {
    const server = await buildTestServer();
    const email = `rate-limit-${randomUUID()}@example.com`;
    const correctPassword = "the real password";
    const passwordHash = await hashPassword(correctPassword);
    await adminPool.query(
      "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, 'Rate Limit Admin')",
      [email, passwordHash],
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await server.inject({
        method: "POST",
        url: "/platform/login",
        payload: { email, password: "wrong" },
      });
      expect(response.statusCode).toBe(401);
    }

    const lockedRow = await adminPool.query<{ locked_until: Date }>(
      "SELECT locked_until FROM super_admins WHERE email = $1",
      [email],
    );
    expect(lockedRow.rows[0].locked_until).not.toBeNull();

    const stillLockedResponse = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email, password: correctPassword },
    });
    expect(stillLockedResponse.statusCode).toBe(429);

    // Simulate the cool-down having elapsed (waiting the real 15 minutes isn't practical here).
    await adminPool.query(
      "UPDATE super_admins SET locked_until = now() - interval '1 minute' WHERE email = $1",
      [email],
    );

    const afterCooldownResponse = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email, password: correctPassword },
    });
    expect(afterCooldownResponse.statusCode).toBe(200);

    const resetRow = await adminPool.query<{ failed_login_count: number }>(
      "SELECT failed_login_count FROM super_admins WHERE email = $1",
      [email],
    );
    expect(resetRow.rows[0].failed_login_count).toBe(0);

    await server.close();
  });
});
