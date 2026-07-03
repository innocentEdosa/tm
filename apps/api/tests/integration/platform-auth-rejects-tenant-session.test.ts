import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";

describe("GET /platform/me — rejects a tenant-scoped session (US2, Acceptance Scenario 1)", () => {
  it("returns 401 when only Spec 1's dev-stub tenant headers are presented (no Super Admin cookie)", async () => {
    const server = await buildTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/platform/me",
      headers: { "x-test-user-id": randomUUID(), "x-test-tenant-id": randomUUID() },
    });

    expect(response.statusCode).toBe(401);
    await server.close();
  });
});
