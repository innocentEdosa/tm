import type { MailMessage, MailSender } from "./mail-sender";
import { ZeptoMailSender } from "./zeptomail-sender";

const SEND_TIMEOUT_MS = 3000;

let activeSender: MailSender = new ZeptoMailSender();

/** Test-only seam — never called outside tests. Lets tests install a fake `MailSender` to prove the
 * wrapper guarantees below hold independent of which provider is active (Email API Mailer spec, User
 * Story 2). Re-exported from `tenant-auth/mailer.ts` for existing call sites/tests. */
export function __setMailSenderForTesting(sender: MailSender): void {
  activeSender = sender;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Mail send timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The single place the non-blocking-failure, skip-when-unconfigured, and bounded-timeout guarantees
 * live (research.md §3, §4 of specs/016-email-api-mailer) — enforced once, around whichever
 * `MailSender` is active, rather than duplicated inside each adapter. Extracted out of
 * `tenant-auth/mailer.ts` (Course Marketplace Updates, spec 032, research.md §8) so a non-auth email
 * (e.g. course-update-mailer.ts) can reuse the exact same guarantees without either duplicating this
 * logic or piling course-marketplace concerns into a tenant-auth-named file. Callers MUST NOT let a
 * rejection here fail the operation that triggered it — the account is created/reset-token issued/
 * notification triggered regardless; a fresh email can always be re-triggered.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!activeSender.isConfigured()) {
    console.warn(`Mail provider not configured — skipping email to ${message.to}`);
    return;
  }
  try {
    await withTimeout(activeSender.send(message), SEND_TIMEOUT_MS);
  } catch (err) {
    console.error(`Failed to send email to ${message.to}:`, err);
  }
}
