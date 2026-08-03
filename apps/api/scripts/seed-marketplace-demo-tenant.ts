import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { tenants } from "../src/db/schema/tenants";
import { users } from "../src/db/schema/users";
import { roles, rolePermissions, userRoles } from "../src/db/schema/roles";
import { permissions } from "../src/db/schema/permissions";
import { tenantAuthMethods } from "../src/db/schema/tenant-auth-methods";
import { hashPassword } from "../src/platform-auth/password";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const db = drizzle(client);

    await db.insert(tenants).values({
      id: tenantId,
      name: "Marketplace Demo Co",
      subdomain: "marketdemo",
      primaryContactName: "Demo Contact",
      primaryContactEmail: "demo@marketdemo.example.com",
    });

    await db.insert(tenantAuthMethods).values({ tenantId, method: "email_password" });

    const passwordHash = await hashPassword("DemoPassword123!");
    await db.insert(users).values({
      id: userId,
      tenantId,
      fullName: "Demo Tenant User",
      email: "demo-user@marketdemo.example.com",
      passwordHash,
      mustChangePassword: false,
    });

    const [role] = await db
      .insert(roles)
      .values({ tenantId, name: "Marketplace Tester" })
      .returning({ id: roles.id });

    const perms = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.key, ["course.manage"]));
    if (perms.length === 0) throw new Error("course.manage permission not found");
    await db.insert(rolePermissions).values(perms.map((p) => ({ roleId: role.id, permissionId: p.id })));
    await db.insert(userRoles).values({ tenantId, userId, roleId: role.id });

    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        { tenantId, subdomain: "marketdemo", userId, email: "demo-user@marketdemo.example.com", password: "DemoPassword123!" },
        null,
        2,
      ),
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
