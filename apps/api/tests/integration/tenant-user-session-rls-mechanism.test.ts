import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";

/**
 * Proves the *standard* tenant_isolation policy alone is sufficient for user_sessions isolation
 * (research.md §3) — no narrow allowance policy is needed here, unlike Spec 4's subdomain lookup,
 * because tenant_id is always independently resolved from the subdomain *before* this table is ever
 * queried (tenant-user-context.ts).
 */
describe("RLS: user_sessions isolation (Tenant Authentication Configuration)", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const sessionATokenHash = randomUUID();
  const sessionBTokenHash = randomUUID();

  afterAll(async () => {
    await closeTestPool();
  });

  it("seeds a user and session for each of two tenants", async () => {
    await withTenantTransaction(tenantA, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Tenant A', $2, 'Jo', 'jo@a.example')`,
        [tenantA, `sess-a-${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email) VALUES ($1, $2, 'Jo A', $3)`,
        [userA, tenantA, `jo-a-${randomUUID()}@a.example`],
      );
      await client.query(
        `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [tenantA, userA, sessionATokenHash],
      );
    });
    await withTenantTransaction(tenantB, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Tenant B', $2, 'Jo', 'jo@b.example')`,
        [tenantB, `sess-b-${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email) VALUES ($1, $2, 'Jo B', $3)`,
        [userB, tenantB, `jo-b-${randomUUID()}@b.example`],
      );
      await client.query(
        `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [tenantB, userB, sessionBTokenHash],
      );
    });
  });

  it("a session lookup under tenant A's app.tenant_id never returns tenant B's session", async () => {
    const rows = await withTenantTransaction(tenantA, async (client) => {
      const result = await client.query("SELECT id FROM user_sessions WHERE token_hash = $1", [
        sessionBTokenHash,
      ]);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("a session lookup under tenant A's app.tenant_id finds tenant A's own session", async () => {
    const rows = await withTenantTransaction(tenantA, async (client) => {
      const result = await client.query("SELECT user_id FROM user_sessions WHERE token_hash = $1", [
        sessionATokenHash,
      ]);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userA);
  });

  it("revoking or expiring a session excludes it even under the correct tenant", async () => {
    const revokedTokenHash = randomUUID();
    await withTenantTransaction(tenantA, async (client) => {
      await client.query(
        `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at, revoked_at)
         VALUES ($1, $2, $3, now() + interval '1 hour', now())`,
        [tenantA, userA, revokedTokenHash],
      );
    });

    const rows = await withTenantTransaction(tenantA, async (client) => {
      const result = await client.query(
        `SELECT id FROM user_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [revokedTokenHash],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });
});
