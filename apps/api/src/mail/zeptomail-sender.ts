import type { MailMessage, MailSender } from "./mail-sender";

const DEFAULT_API_URL = "https://api.zeptomail.com/v1.1/email";
const REQUEST_TIMEOUT_MS = 3000;

interface ZeptoMailErrorResponse {
  error?: { code?: string; message?: string };
}

/**
 * ZeptoMail's implementation of `MailSender` (contracts/zeptomail-api.md, data-model.md). Every
 * ZeptoMail-specific detail — endpoint, auth header shape, request/response JSON shape, env var
 * names — lives in this one file; nothing outside it (including `tenant-auth/mailer.ts`) knows
 * ZeptoMail exists (FR-002, FR-007).
 *
 * `send()` intentionally does not catch its own failures — `mailer.ts`'s wrapper owns the
 * non-blocking/logging guarantee (research.md §3), not this adapter.
 */
export class ZeptoMailSender implements MailSender {
  isConfigured(): boolean {
    return Boolean(process.env.MAIL_API_TOKEN && process.env.MAIL_FROM_EMAIL);
  }

  async send(message: MailMessage): Promise<void> {
    const apiUrl = process.env.MAIL_API_URL || DEFAULT_API_URL;
    const fromName = process.env.MAIL_FROM_NAME || "TM";

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `${process.env.MAIL_API_TOKEN}`,
      },
      body: JSON.stringify({
        from: { address: process.env.MAIL_FROM_EMAIL, name: fromName },
        to: [{ email_address: { address: message.to, name: message.to } }],
        subject: message.subject,
        textbody: message.text,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as ZeptoMailErrorResponse | undefined;
      const detail = body?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`ZeptoMail send failed: ${detail}`);
    }
  }
}
