import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { hashPassword } from "../../src/platform-auth/password";

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

describe("POST /platform/login — no account enumeration (FR-008, SC-003)", () => {
  afterAll(async () => {
    await adminPool.end();
  });

  it("returns byte-identical responses for a wrong password vs. a nonexistent email", async () => {
    const server = await buildTestServer();
    const realEmail = `no-enum-${randomUUID()}@example.com`;
    const passwordHash = await hashPassword("the real password");
    await adminPool.query(
      "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, 'No Enum Admin')",
      [realEmail, passwordHash],
    );

    const wrongPasswordResponse = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email: realEmail, password: "definitely wrong" },
    });

    const unknownEmailResponse = await server.inject({
      method: "POST",
      url: "/platform/login",
      payload: { email: `nobody-${randomUUID()}@example.com`, password: "definitely wrong" },
    });

    expect(wrongPasswordResponse.statusCode).toBe(401);
    expect(unknownEmailResponse.statusCode).toBe(401);
    expect(wrongPasswordResponse.body).toBe(unknownEmailResponse.body);

    await server.close();
  });
});
