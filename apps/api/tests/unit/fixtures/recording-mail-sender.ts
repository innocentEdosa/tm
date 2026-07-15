import type { MailMessage, MailSender } from "../../../src/mail/mail-sender";

/**
 * A minimal, throwaway second `MailSender` — proves a provider swap needs nothing but a new file
 * implementing this interface (Email API Mailer spec, User Story 2). Never wired in outside tests;
 * records what it received instead of calling any real API.
 */
export class RecordingMailSender implements MailSender {
  readonly received: MailMessage[] = [];

  isConfigured(): boolean {
    return true;
  }

  async send(message: MailMessage): Promise<void> {
    this.received.push(message);
  }
}
