import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction, withSuperAdminTransaction } from "../helpers/pg";
import { seedTenant, seedSuperAdminSession } from "../helpers/fixtures";
import { buildTestServer } from "../helpers/test-server";

const execFileAsync = promisify(execFile);

async function runPurgeScript(): Promise<void> {
  const scriptPath = path.resolve(__dirname, "../../scripts/purge-deleted-tenants.ts");
  await execFileAsync("npx", ["tsx", scriptPath], {
    env: { ...process.env },
    cwd: path.resolve(__dirname, "../.."),
  });
}

describe("purge-deleted-tenants.ts — permanent removal after the grace period (spec FR-015b)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("permanently removes a tenant and its data once past its purge date; recover then 404s", async () => {
    const server = await buildTestServer();
    const tenantId = randomUUID();
    const tenantName = `Purge Test ${tenantId}`;
    await seedTenant(tenantId, tenantName);

    const userId = randomUUID();
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email) VALUES ($1, $2, 'Purge User', $3)`,
        [userId, tenantId, `purge-user-${userId}@example.com`],
      );
      await client.query(
        `INSERT INTO departments (tenant_id, name, manager_id) VALUES ($1, 'Purge Dept', $2)`,
        [tenantId, userId],
      );
    });

    const { cookieHeader } = await seedSuperAdminSession();
    const deleteResponse = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/delete`,
      headers: { cookie: cookieHeader },
      payload: { confirmTenantName: tenantName },
    });
    expect(deleteResponse.statusCode).toBe(200);

    // Backdate deletion_purge_at into the past — the grace period itself isn't under test here.
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(`UPDATE tenants SET deletion_purge_at = now() - interval '1 day' WHERE id = $1`, [
        tenantId,
      ]);
    });

    await runPurgeScript();

    // Verified through the same RLS allowances the app itself uses — a plain unscoped query would
    // return zero rows regardless of whether the purge actually ran (tenant_isolation alone hides
    // everything with no app.tenant_id/app.is_super_admin set), which would make this assertion
    // pass vacuously.
    const tenantRows = await withSuperAdminTransaction(async (client) => {
      const result = await client.query(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
      return result.rows;
    });
    expect(tenantRows.length).toBe(0);

    const userRows = await withTenantTransaction(tenantId, async (client) => {
      const result = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
      return result.rows;
    });
    expect(userRows.length).toBe(0);

    const recoverResponse = await server.inject({
      method: "POST",
      url: `/tenants/${tenantId}/recover`,
      headers: { cookie: cookieHeader },
    });
    expect(recoverResponse.statusCode).toBe(404);

    await server.close();
  }, 30000);
});
