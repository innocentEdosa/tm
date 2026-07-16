/**
 * The provider-agnostic contract every mail adapter implements (contracts/mail-sender-interface.md,
 * Email API Mailer spec). `tenant-auth/mailer.ts`'s two public functions delegate through exactly
 * this interface — a future provider swap means adding one new implementation of `MailSender` and
 * changing which one is wired in there, never touching a call site.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailSender {
  /** MUST return false whenever any credential this provider needs is missing/empty, and MUST NOT
   * perform a network call to determine this (research.md §5; FR-005). */
  isConfigured(): boolean;
  /** Attempts exactly one delivery. MAY throw/reject for any failure — the caller (`mailer.ts`) owns
   * catching it, not this method (research.md §3). */
  send(message: MailMessage): Promise<void>;
}
