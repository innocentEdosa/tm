import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestPool, seedTenantRole, withTenantTransaction } from "../helpers/pg";

describe("RLS cross-tenant isolation (roles)", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let tenantBRoleId: string;

  beforeAll(async () => {
    await seedTenantRole(tenantA, "Tenant A Role");
    const roleB = await seedTenantRole(tenantB, "Tenant B Role");
    tenantBRoleId = roleB.id;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("returns zero rows reading tenant B's role from tenant A's session", async () => {
    const rows = await withTenantTransaction(tenantA, async (client) => {
      const result = await client.query("SELECT * FROM roles WHERE id = $1", [tenantBRoleId]);
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("affects zero rows updating tenant B's role from tenant A's session", async () => {
    const rowCount = await withTenantTransaction(tenantA, async (client) => {
      const result = await client.query("UPDATE roles SET name = 'hijacked' WHERE id = $1", [
        tenantBRoleId,
      ]);
      return result.rowCount;
    });

    expect(rowCount).toBe(0);

    const stillIntact = await withTenantTransaction(tenantB, async (client) => {
      const result = await client.query<{ name: string }>("SELECT name FROM roles WHERE id = $1", [
        tenantBRoleId,
      ]);
      return result.rows[0]?.name;
    });
    expect(stillIntact).toBe("Tenant B Role");
  });

  it("fails closed — returns zero rows or throws (never all tenants') when app.tenant_id is unset", async () => {
    // Postgres treats the unset case as either NULL (current_setting returns NULL, RLS excludes
    // every row) or "" on a pooled connection that previously had a real tenant id set in a
    // different transaction (::uuid cast on "" throws) — quickstart.md §2 accepts both as
    // fail-closed; the one unacceptable outcome is returning any row.
    let rows: unknown[] | undefined;
    let thrown: unknown;
    try {
      rows = await withTenantTransaction(null, async (client) => {
        const result = await client.query("SELECT * FROM roles");
        return result.rows;
      });
    } catch (err) {
      thrown = err;
    }

    if (thrown) {
      expect(String(thrown)).toMatch(/invalid input syntax for type uuid/);
    } else {
      expect(rows).toHaveLength(0);
    }
  });
});
