import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";

/**
 * Proves RLS on `tenants`/`departments`/`users` in isolation from application code (research.md
 * §1), mirroring Spec 1's `rls-cross-tenant.test.ts`. Seeds rows directly via raw SQL using the same
 * bootstrap idiom `provisionTenant` uses (SET LOCAL app.tenant_id to the row's own id before insert)
 * — not through `provisionTenant` itself, so this test stays valid regardless of what later phases
 * add to that function.
 */
describe("RLS cross-tenant isolation (tenants, departments, users)", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let departmentBId: string;
  let userBId: string;

  beforeAll(async () => {
    await withTenantTransaction(tenantA, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Tenant A', $2, 'A Contact', 'a@example.com')`,
        [tenantA, `tenant-a-${tenantA}`],
      );
    });

    await withTenantTransaction(tenantB, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Tenant B', $2, 'B Contact', 'b@example.com')`,
        [tenantB, `tenant-b-${tenantB}`],
      );
      const dept = await client.query<{ id: string }>(
        `INSERT INTO departments (tenant_id, name) VALUES ($1, 'B Department') RETURNING id`,
        [tenantB],
      );
      departmentBId = dept.rows[0].id;
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, full_name, email) VALUES ($1, 'B User', 'b.user@example.com')
         RETURNING id`,
        [tenantB],
      );
      userBId = user.rows[0].id;
    });
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("returns zero rows reading tenant B's tenant/department/user from tenant A's session", async () => {
    const rows = await withTenantTransaction(tenantA, async (client) => {
      const tenantRows = await client.query("SELECT * FROM tenants WHERE id = $1", [tenantB]);
      const deptRows = await client.query("SELECT * FROM departments WHERE id = $1", [departmentBId]);
      const userRows = await client.query("SELECT * FROM users WHERE id = $1", [userBId]);
      return { tenantRows: tenantRows.rows, deptRows: deptRows.rows, userRows: userRows.rows };
    });

    expect(rows.tenantRows).toHaveLength(0);
    expect(rows.deptRows).toHaveLength(0);
    expect(rows.userRows).toHaveLength(0);
  });

  it("affects zero rows updating tenant B's department from tenant A's session", async () => {
    const rowCount = await withTenantTransaction(tenantA, async (client) => {
      const result = await client.query("UPDATE departments SET name = 'hijacked' WHERE id = $1", [
        departmentBId,
      ]);
      return result.rowCount;
    });
    expect(rowCount).toBe(0);

    const stillIntact = await withTenantTransaction(tenantB, async (client) => {
      const result = await client.query<{ name: string }>(
        "SELECT name FROM departments WHERE id = $1",
        [departmentBId],
      );
      return result.rows[0]?.name;
    });
    expect(stillIntact).toBe("B Department");
  });

  it("fails closed — zero rows across all three tables when app.tenant_id is unset", async () => {
    let rows: { tenants: unknown[]; departments: unknown[]; users: unknown[] } | undefined;
    let thrown: unknown;
    try {
      rows = await withTenantTransaction(null, async (client) => {
        const t = await client.query("SELECT * FROM tenants");
        const d = await client.query("SELECT * FROM departments");
        const u = await client.query("SELECT * FROM users");
        return { tenants: t.rows, departments: d.rows, users: u.rows };
      });
    } catch (err) {
      thrown = err;
    }

    if (thrown) {
      expect(String(thrown)).toMatch(/invalid input syntax for type uuid/);
    } else {
      expect(rows?.tenants).toHaveLength(0);
      expect(rows?.departments).toHaveLength(0);
      expect(rows?.users).toHaveLength(0);
    }
  });
});
