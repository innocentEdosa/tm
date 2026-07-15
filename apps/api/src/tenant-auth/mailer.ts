import type { MailMessage, MailSender } from "../mail/mail-sender";
import { ZeptoMailSender } from "../mail/zeptomail-sender";

const SEND_TIMEOUT_MS = 3000;

let activeSender: MailSender = new ZeptoMailSender();

/** Test-only seam — never called outside tests. Mirrors `server.ts`'s `registerAuthStub` precedent:
 * lets tests install a fake `MailSender` to prove the wrapper guarantees below hold independent of
 * which provider is active (Email API Mailer spec, User Story 2). */
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
 * live (research.md §3, §4) — enforced once, around whichever `MailSender` is active, rather than
 * duplicated inside each adapter. Callers (the two exported functions below) MUST NOT let a
 * rejection here fail the operation that triggered it (spec Edge Cases; FR-004) — the account is
 * created/reset-token issued regardless; a fresh email can always be re-triggered.
 */
async function sendMail(message: MailMessage): Promise<void> {
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

export async function sendOneTimePasswordEmail(to: string, otp: string): Promise<void> {
  await sendMail({
    to,
    subject: "Set up your TM account",
    text: `Welcome to TM. Your one-time password is: ${otp}\n\nLog in with this password — you'll be asked to set your own right away. This one-time password expires in 72 hours.`,
  });
}

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  await sendMail({
    to,
    subject: "Reset your TM password",
    text: `Reset your password using this link: ${resetLink}\n\nThis link expires in 1 hour and can only be used once.`,
  });
}
