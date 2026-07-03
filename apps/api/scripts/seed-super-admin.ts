import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { createInterface } from "node:readline/promises";
import { superAdmins } from "../src/db/schema/super-admins";
import { hashPassword } from "../src/platform-auth/password";

/**
 * contracts/seed-super-admin-script.md. Standalone CLI, never invoked by the running server —
 * connects via DATABASE_URL (the migration/owner role), which has INSERT on `super_admins`;
 * `tm_app` (the running server's role) deliberately does not (research.md §7).
 *
 * Note: interactive password entry below is NOT masked (no built-in-only way to hide terminal
 * input without hand-rolling raw-mode stdin handling) — the `SUPER_ADMIN_EMAIL`/
 * `SUPER_ADMIN_PASSWORD` env-var path is the expected route for anything beyond a quick local
 * convenience run.
 */
async function promptForCredentials(): Promise<{ email: string; password: string; name: string }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = await rl.question("Super Admin email: ");
    const name = await rl.question("Super Admin name: ");
    const password = await rl.question("Super Admin password: ");
    return { email: email.trim(), password, name: name.trim() };
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    const countResult = await db.execute(sql`SELECT count(*)::int AS count FROM super_admins`);
    const existingCount = (countResult.rows[0] as { count: number }).count;
    if (existingCount > 0 && process.env.ALLOW_ADDITIONAL_SUPER_ADMIN !== "true") {
      console.log(
        `${existingCount} Super Admin account(s) already exist. No changes made. ` +
          "Set ALLOW_ADDITIONAL_SUPER_ADMIN=true to add another.",
      );
      return;
    }

    let email = process.env.SUPER_ADMIN_EMAIL?.trim();
    let password = process.env.SUPER_ADMIN_PASSWORD;
    let name = process.env.SUPER_ADMIN_NAME?.trim();
    if (!email || !password || !name) {
      const prompted = await promptForCredentials();
      email = email ?? prompted.email;
      password = password ?? prompted.password;
      name = name ?? prompted.name;
    }

    if (!email || !password || !name) {
      console.error("Email, name, and password are required.");
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);
    await db.insert(superAdmins).values({
      email: email.toLowerCase(),
      passwordHash,
      name,
    });

    console.log(`Created Super Admin account: ${email.toLowerCase()}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
