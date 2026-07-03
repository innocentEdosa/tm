import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";

/**
 * FR-012, Acceptance Scenario 3: `request.superAdmin`/`app.is_super_admin` are derived only from a
 * real, DB-verified `super_admin_sessions` row — never from any client-supplied header, cookie
 * value, or request field.
 */
describe("GET /platform/me — the Super Admin flag cannot be forged by the client", () => {
  it("ignores a forged x-is-super-admin header with no real session", async () => {
    const server = await buildTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/platform/me",
      headers: { "x-is-super-admin": "true" },
    });

    expect(response.statusCode).toBe(401);
    await server.close();
  });

  it("ignores a well-formed but non-existent session token", async () => {
    const server = await buildTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/platform/me",
      headers: { cookie: `tm_super_admin_session=${randomUUID()}` },
    });

    expect(response.statusCode).toBe(401);
    await server.close();
  });
});
