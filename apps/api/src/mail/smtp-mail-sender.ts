import nodemailer from "nodemailer";
import type { MailMessage, MailSender } from "./mail-sender";

// Kept under send-mail.ts's own SEND_TIMEOUT_MS (3000ms, a guaranteed-resolve-by budget covering
// both providers) so a slow SMTP phase surfaces its own specific nodemailer error rather than always
// racing the generic outer "Mail send timed out" wrapper.
const CONNECTION_TIMEOUT_MS = 2500;

/**
 * SMTP implementation of `MailSender` — an alternative to `ZeptoMailSender`'s HTTP API delivery,
 * selected via `MAIL_PROVIDER=smtp` (see `send-mail.ts`). Works against any SMTP server/relay (a
 * provider's own SMTP endpoint, e.g. ZeptoMail's, or a third party like Mailtrap/SendGrid/SES) — the
 * `MAIL_FROM_EMAIL`/`MAIL_FROM_NAME` "from" identity is shared with the API path (provider-agnostic
 * naming, same as `ZeptoMailSender`); only the transport-specific `SMTP_*` credentials are unique to
 * this file, mirroring `ZeptoMailSender`'s own "every provider-specific detail lives in its own
 * adapter" shape.
 */
export class SmtpMailSender implements MailSender {
  isConfigured(): boolean {
    return Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_PORT &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASSWORD &&
        process.env.MAIL_FROM_EMAIL,
    );
  }

  async send(message: MailMessage): Promise<void> {
    const host = process.env.SMTP_HOST!;
    const port = Number(process.env.SMTP_PORT);
    const user = process.env.SMTP_USER!;
    const pass = process.env.SMTP_PASSWORD!;
    const fromName = process.env.MAIL_FROM_NAME || "TM";
    // Implicit TLS on 465 is the standard default; every other port (587 STARTTLS, 25, a sandbox
    // relay's own custom port) defaults to plain-then-upgrade, same as most SMTP clients — overridable
    // via SMTP_SECURE for a provider that doesn't follow the convention.
    const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: CONNECTION_TIMEOUT_MS,
      socketTimeout: CONNECTION_TIMEOUT_MS,
    });

    await transporter.sendMail({
      from: { address: process.env.MAIL_FROM_EMAIL!, name: fromName },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
