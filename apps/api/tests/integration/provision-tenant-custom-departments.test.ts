import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

describe("POST /provisioning/tenants — customized department list (US3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates exactly the submitted list (rename + add + remove relative to defaults), source_template_id NULL", async () => {
    const server = await buildTestServer();
    const { cookieHeader } = await seedSuperAdminSession();
    const subdomain = `acme-${randomUUID()}`;

    // Relative to the six defaults: "Human Resources" renamed to "People Ops", "Sales" and
    // "Customer Support" dropped, "Field Operations" added new.
    const customDepartments = [
      { name: "People Ops" },
      { name: "Engineering" },
      { name: "Finance" },
      { name: "Operations" },
      { name: "Field Operations" },
    ];

    const response = await server.inject({
      method: "POST",
      url: "/provisioning/tenants",
      headers: { cookie: cookieHeader },
      payload: {
        company: {
          name: "Acme Corp",
          subdomain,
          primaryContact: { name: "Jordan Lee", email: "jordan.lee@acme.example" },
        },
        departments: customDepartments,
        admin: { fullName: "Priya Shah", email: `priya.shah+${randomUUID()}@acme.example` },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    const names = body.data.departments.map((d: { name: string }) => d.name).sort();
    expect(names).toEqual(customDepartments.map((d) => d.name).sort());

    const tenantId: string = body.data.tenant.id;
    const sourceTemplateIds = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ source_template_id: string | null }>(
        "SELECT source_template_id FROM departments WHERE tenant_id = $1",
        [tenantId],
      );
      return result.rows.map((r) => r.source_template_id);
    });
    expect(sourceTemplateIds).toHaveLength(5);
    expect(sourceTemplateIds.every((id) => id === null)).toBe(true);

    await server.close();
  });
});
