import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";

/**
 * Proves the HTTP boundary (GET /tenant-routing/resolve) never leaks `tenantId`, even though the
 * underlying resolveTenantBySubdomain() function now returns it for in-process callers (Tenant
 * Authentication Configuration spec) — the route handler explicitly allow-lists response fields
 * rather than spreading the function's full result.
 */
describe("GET /tenant-routing/resolve — HTTP response allow-list", () => {
  const tenantId = randomUUID();
  const subdomain = `allowlist-${randomUUID()}`;

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a valid tenant", async () => {
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Allowlist Co', $2, 'Jo', 'jo@allowlist.example')`,
        [tenantId, subdomain],
      );
    });
  });

  it("never includes tenantId in the JSON response", async () => {
    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "GET",
        url: `/tenant-routing/resolve?subdomain=${subdomain}`,
      });
      const body = JSON.parse(response.body) as { data: Record<string, unknown> };
      expect(body.data.state).toBe("valid");
      expect(body.data.tenantName).toBe("Allowlist Co");
      expect(body.data).not.toHaveProperty("tenantId");
      expect(body.data).not.toHaveProperty("id");
    } finally {
      await server.close();
    }
  });
});
