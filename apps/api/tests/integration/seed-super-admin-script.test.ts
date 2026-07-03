import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runSeedScript(env: Record<string, string>): Promise<{ stdout: string }> {
  return execFileAsync("npx", ["tsx", "scripts/seed-super-admin.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
}

describe("seed-super-admin script (FR-014, FR-015)", () => {
  afterAll(async () => {
    await adminPool.end();
  });

  it("creates exactly one Super Admin with a securely hashed password, and re-running makes no changes", async () => {
    // FR-015's "safe to re-run" logic checks the GLOBAL super_admins count, not per-email — this
    // test needs a genuinely empty table to exercise "against an empty super_admins table" as
    // literally described, since earlier test files in this sequential suite (fileParallelism:
    // false, no per-file cleanup — matching established project precedent) leave real rows behind.
    await adminPool.query("DELETE FROM super_admin_sessions");
    await adminPool.query("DELETE FROM super_admins");

    const email = `seed-test-${randomUUID()}@example.com`;

    await runSeedScript({
      SUPER_ADMIN_EMAIL: email,
      SUPER_ADMIN_PASSWORD: "correct horse battery",
      SUPER_ADMIN_NAME: "Seed Test Admin",
    });

    const afterFirstRun = await adminPool.query<{ password_hash: string; name: string }>(
      "SELECT password_hash, name FROM super_admins WHERE email = $1",
      [email],
    );
    expect(afterFirstRun.rows).toHaveLength(1);
    expect(afterFirstRun.rows[0].name).toBe("Seed Test Admin");
    expect(afterFirstRun.rows[0].password_hash).not.toContain("correct horse battery");
    expect(afterFirstRun.rows[0].password_hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

    const { stdout } = await runSeedScript({
      SUPER_ADMIN_EMAIL: `another-${randomUUID()}@example.com`,
      SUPER_ADMIN_PASSWORD: "irrelevant",
    });
    expect(stdout).toMatch(/already exist/i);

    const totalCount = await adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM super_admins",
    );
    expect(totalCount.rows[0].count).toBe("1");
  }, 20_000);
});
