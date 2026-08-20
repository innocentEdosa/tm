import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantDb, withTenantTransaction } from "../helpers/pg";
import { hashPassword } from "../../src/platform-auth/password";
import { tnaExercises } from "../../src/db/schema/tna-exercises";
import { tnaAssignments } from "../../src/db/schema/tna-assignments";

/** `hasTnaAssignment` on `GET /tenant-auth/me` is what lets the dashboard shell show the TNA nav
 * entry to a plain assigned participant who holds neither `tna.manage` nor `tna.view` — it must be
 * true for a participant reached by ANY targeting mechanism (department manager/assistant-manager,
 * role, or direct user), since all three resolve into the same `tna_assignments` table
 * (resolve-tna-participants.ts) and this endpoint only checks row existence, not how it got there. */
describe("GET /tenant-auth/me — hasTnaAssignment", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function loginAndFetchMe(server: Awaited<ReturnType<typeof buildTestServer>>, subdomain: string, email: string, password: string) {
    const loginResponse = await server.inject({
      method: "POST",
      url: `/tenant-auth/login?subdomain=${subdomain}`,
      payload: { email, password },
    });
    const cookie = (loginResponse.headers["set-cookie"] as string).split(";")[0];
    const meResponse = await server.inject({
      method: "GET",
      url: `/tenant-auth/me?subdomain=${subdomain}`,
      headers: { cookie },
    });
    return meResponse;
  }

  it("is false for a user with no tna_assignments row at all", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const subdomain = `me-no-tna-${randomUUID()}`;
    const email = `jo+${randomUUID()}@me-no-tna.example`;
    const password = "a real password";

    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Me No TNA Co', $2, 'Jo', 'jo@me-no-tna.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email, password_hash, must_change_password)
         VALUES ($1, $2, 'Jo Unassigned', $3, $4, false)`,
        [userId, tenantId, email, await hashPassword(password)],
      );
    });

    const server = await buildTestServer();
    try {
      const meResponse = await loginAndFetchMe(server, subdomain, email, password);
      expect(meResponse.statusCode).toBe(200);
      expect(meResponse.json().data.hasTnaAssignment).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("is true for a user with a tna_assignments row, regardless of which targeting mechanism produced it", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const subdomain = `me-has-tna-${randomUUID()}`;
    const email = `jo+${randomUUID()}@me-has-tna.example`;
    const password = "a real password";

    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Me Has TNA Co', $2, 'Jo', 'jo@me-has-tna.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email, password_hash, must_change_password)
         VALUES ($1, $2, 'Jo Assigned', $3, $4, false)`,
        [userId, tenantId, email, await hashPassword(password)],
      );
    });

    await withTenantDb(tenantId, async (db) => {
      // status: "active" — hasTnaAssignment must only surface an assignment once HR has started the
      // exercise; a still-draft exercise's assignments (resolved as soon as targets are set, see
      // syncTnaAssignments in tenant-tna-routes.ts) must stay invisible to the participant.
      const [exercise] = await db
        .insert(tnaExercises)
        .values({ tenantId, title: "Assignment Visibility Test", endDate: "2099-12-31", status: "active", startedAt: new Date() })
        .returning({ id: tnaExercises.id });
      // sourceTargetType: "role" here is just one of the three resolution paths
      // (resolve-tna-participants.ts) — this endpoint only checks row existence, so it doesn't
      // matter which one produced the row; department/user-sourced rows are covered structurally
      // the same way.
      await db.insert(tnaAssignments).values({
        tenantId,
        tnaExerciseId: exercise.id,
        userId,
        departmentId: null,
        sourceTargetType: "role",
        magicLinkTokenHash: randomUUID(),
      });
    });

    const server = await buildTestServer();
    try {
      const meResponse = await loginAndFetchMe(server, subdomain, email, password);
      expect(meResponse.statusCode).toBe(200);
      expect(meResponse.json().data.hasTnaAssignment).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("is false when the only tna_assignments row belongs to a still-draft exercise", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const subdomain = `me-draft-tna-${randomUUID()}`;
    const email = `jo+${randomUUID()}@me-draft-tna.example`;
    const password = "a real password";

    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Me Draft TNA Co', $2, 'Jo', 'jo@me-draft-tna.example')`,
        [tenantId, subdomain],
      );
      await client.query(
        `INSERT INTO users (id, tenant_id, full_name, email, password_hash, must_change_password)
         VALUES ($1, $2, 'Jo Not Yet Started', $3, $4, false)`,
        [userId, tenantId, email, await hashPassword(password)],
      );
    });

    await withTenantDb(tenantId, async (db) => {
      // status defaults to "draft" — assignments are resolved as soon as targets are set
      // (syncTnaAssignments) but must not be visible to the participant until HR clicks Start.
      const [exercise] = await db
        .insert(tnaExercises)
        .values({ tenantId, title: "Not Started Yet", endDate: "2099-12-31" })
        .returning({ id: tnaExercises.id });
      await db.insert(tnaAssignments).values({
        tenantId,
        tnaExerciseId: exercise.id,
        userId,
        departmentId: null,
        sourceTargetType: "user",
        magicLinkTokenHash: randomUUID(),
      });
    });

    const server = await buildTestServer();
    try {
      const meResponse = await loginAndFetchMe(server, subdomain, email, password);
      expect(meResponse.statusCode).toBe(200);
      expect(meResponse.json().data.hasTnaAssignment).toBe(false);
    } finally {
      await server.close();
    }
  });
});
