import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { __setMailSenderForTesting } from "../../src/tenant-auth/mailer";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { RecordingMailSender } from "../unit/fixtures/recording-mail-sender";

const TOKEN_PATTERN = /token=([a-f0-9]{64})/;

/** No-login magic-link access to a TNA response (public-tna-routes.ts): the raw token is only ever
 * observable in the assignment-notification email, so every test here captures it via a
 * `RecordingMailSender` rather than reading it back from any API response (the DB only ever stores
 * its hash). */
describe("TNA: magic-link response access (no session)", () => {
  afterEach(() => {
    __setMailSenderForTesting(new ZeptoMailSender());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  async function seedStartedExercise(subdomainSuffix: string, endDate: string) {
    const tenantId = randomUUID();
    await seedTenant(tenantId, `Magic Link Co ${subdomainSuffix}`);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["tna.manage"]);

    const { deptId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db.insert(users).values({ tenantId, fullName: "Manager", email: `m-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [dept] = await db.insert(departments).values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id }).returning({ id: departments.id });
      return { deptId: dept.id };
    });

    // seedTenant (fixtures.ts) always writes subdomain = `test-${tenantId}` — no round-trip needed.
    const subdomain = `test-${tenantId}`;

    const recorder = new RecordingMailSender();
    __setMailSenderForTesting(recorder);

    const server = await buildTestServer();
    const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
    const created = await server.inject({
      method: "POST",
      url: "/tenant/tna-exercises",
      headers: adminHeaders,
      payload: { title: "Magic Link Test", endDate, targets: [{ type: "department", departmentId: deptId }] },
    });
    const exerciseId = created.json().data.id;
    await server.inject({ method: "POST", url: `/tenant/tna-exercises/${exerciseId}/start`, headers: adminHeaders });
    await server.close();

    expect(recorder.received).toHaveLength(1);
    const match = recorder.received[0].text.match(TOKEN_PATTERN);
    expect(match).not.toBeNull();
    const token = match![1];

    return { tenantId, subdomain, token, exerciseId };
  }

  it("resolves, saves a draft, and submits via the token alone — no session headers at all", async () => {
    const { subdomain, token } = await seedStartedExercise(randomUUID(), "2099-12-31");

    const server = await buildTestServer();
    try {
      const get = await server.inject({ method: "GET", url: `/public/tna-assignments?token=${token}&subdomain=${subdomain}` });
      expect(get.statusCode).toBe(200);
      const body = get.json().data;
      expect(body.exerciseTitle).toBe("Magic Link Test");
      expect(body.status).toBe("pending");
      expect(body.responses).toEqual([]);
      expect(body.form.steps.flatMap((s: { sections: { fields: unknown[] }[] }) => s.sections.flatMap((sec) => sec.fields)).length).toBeGreaterThan(0);

      const started = await server.inject({
        method: "POST",
        url: `/public/tna-assignments/responses?token=${token}&subdomain=${subdomain}`,
      });
      expect(started.statusCode).toBe(201);
      const responseId = started.json().data.id;

      const saveDraft = await server.inject({
        method: "PATCH",
        url: `/public/tna-assignments/responses/${responseId}?token=${token}&subdomain=${subdomain}`,
        payload: { values: { skill_gaps: "Draft answer" } },
      });
      expect(saveDraft.statusCode).toBe(200);

      const afterDraft = await server.inject({ method: "GET", url: `/public/tna-assignments?token=${token}&subdomain=${subdomain}` });
      expect(afterDraft.json().data.responses[0].values.skill_gaps).toBe("Draft answer");

      const missingRequired = await server.inject({
        method: "POST",
        url: `/public/tna-assignments/responses/${responseId}/submit?token=${token}&subdomain=${subdomain}`,
        payload: { values: { skill_gaps: "Draft answer" } },
      });
      expect(missingRequired.statusCode).toBe(422);

      const submit = await server.inject({
        method: "POST",
        url: `/public/tna-assignments/responses/${responseId}/submit?token=${token}&subdomain=${subdomain}`,
        payload: { values: { skill_gaps: "Final answer", priority: "High" } },
      });
      expect(submit.statusCode).toBe(200);

      const afterSubmit = await server.inject({ method: "GET", url: `/public/tna-assignments?token=${token}&subdomain=${subdomain}` });
      expect(afterSubmit.json().data.status).toBe("submitted");

      const secondSubmit = await server.inject({
        method: "POST",
        url: `/public/tna-assignments/responses/${responseId}/submit?token=${token}&subdomain=${subdomain}`,
        payload: { values: { skill_gaps: "Second try", priority: "Low" } },
      });
      expect(secondSubmit.statusCode).toBe(409);

      // A department can have more than one training need — a second response can still be started
      // and submitted via the same magic link after the first is locked.
      const startedAgain = await server.inject({
        method: "POST",
        url: `/public/tna-assignments/responses?token=${token}&subdomain=${subdomain}`,
      });
      expect(startedAgain.statusCode).toBe(201);
      expect(startedAgain.json().data.id).not.toBe(responseId);
    } finally {
      await server.close();
    }
  });

  it("rejects an unrecognized token, and blocks starting a response once the deadline has passed", async () => {
    const { subdomain } = await seedStartedExercise(randomUUID(), "2099-12-31");
    const { subdomain: pastSubdomain, token: pastToken } = await seedStartedExercise(randomUUID(), "2020-01-02");

    const server = await buildTestServer();
    try {
      const badToken = await server.inject({
        method: "GET",
        url: `/public/tna-assignments?token=${"0".repeat(64)}&subdomain=${subdomain}`,
      });
      expect(badToken.statusCode).toBe(404);

      const startPastDeadline = await server.inject({
        method: "POST",
        url: `/public/tna-assignments/responses?token=${pastToken}&subdomain=${pastSubdomain}`,
      });
      expect(startPastDeadline.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it("a token from one tenant is invisible under another tenant's subdomain", async () => {
    const { token } = await seedStartedExercise(randomUUID(), "2099-12-31");
    const { subdomain: otherSubdomain } = await seedStartedExercise(randomUUID(), "2099-12-31");

    const server = await buildTestServer();
    try {
      const crossTenant = await server.inject({
        method: "GET",
        url: `/public/tna-assignments?token=${token}&subdomain=${otherSubdomain}`,
      });
      expect(crossTenant.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
