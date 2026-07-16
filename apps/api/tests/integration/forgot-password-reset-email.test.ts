import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { closeTestPool, withTenantTransaction } from "../helpers/pg";
import { __setMailSenderForTesting } from "../../src/tenant-auth/mailer";
import { ZeptoMailSender } from "../../src/mail/zeptomail-sender";
import { RecordingMailSender } from "../unit/fixtures/recording-mail-sender";

/**
 * Spec 019 (Transactional Email Template Redesign) User Story 3 — the reset email is now branded,
 * carries the same reset link the route generated, and states the 1-hour/single-use/ignore-note
 * language (spec FR-004).
 */
describe("POST /tenant-auth/forgot-password — reset email content (spec 019 User Story 3, FR-004)", () => {
  afterEach(() => {
    __setMailSenderForTesting(new ZeptoMailSender());
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("sends exactly one branded reset email carrying the generated reset link", async () => {
    const recorder = new RecordingMailSender();
    __setMailSenderForTesting(recorder);

    const tenantId = randomUUID();
    const subdomain = `forgot-email-${randomUUID()}`;
    const email = `jo+${randomUUID()}@forgotemail.example`;
    await withTenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, subdomain, primary_contact_name, primary_contact_email)
         VALUES ($1, 'Forgot Email Co', $2, 'Jo', 'jo@forgotemail.example')`,
        [tenantId, subdomain],
      );
      await client.query(`INSERT INTO users (tenant_id, full_name, email) VALUES ($1, 'Jo Admin', $2)`, [
        tenantId,
        email,
      ]);
    });

    const server = await buildTestServer();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/tenant-auth/forgot-password?subdomain=${subdomain}`,
        payload: { email },
      });
      expect(response.statusCode).toBe(200);

      expect(recorder.received).toHaveLength(1);
      const [message] = recorder.received;
      expect(message.to).toBe(email);
      const resetLinkMatch = message.text.match(/https?:\/\/\S*\/reset-password\?token=(\S+)/);
      expect(resetLinkMatch).not.toBeNull();
      const [rawResetLink, token] = resetLinkMatch!;
      expect(message.text).toContain(rawResetLink);
      // The html body HTML-escapes `&` (spec FR-007) so this checks the token survives intact rather
      // than matching the raw (unescaped) URL string.
      expect(message.html).toContain(token.split("&")[0]);
      expect(message.html).toContain("/reset-password?token=");
      expect(message.text).toContain("1 hour");
      expect(message.text.toLowerCase()).toContain("single");
      expect(message.text.toLowerCase()).toMatch(/ignore|didn't request|did not request/);
    } finally {
      await server.close();
    }
  });
});
