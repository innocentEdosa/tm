import nodemailer from "nodemailer";

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;

/** Lazily built so a missing SMTP env var only fails when an email is actually sent, not at
 * module-load time (keeps the test suite runnable without real SMTP credentials configured). */
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      // Fails fast (rather than hanging on the default multi-minute socket timeout) when SMTP is
      // unreachable or misconfigured — matters for both the test suite (no SMTP configured) and
      // production (callers must not let a slow/hung SMTP server stall the request that triggered
      // the email, per the Edge Case note below).
      connectionTimeout: 1500,
      greetingTimeout: 1500,
      socketTimeout: 1500,
    });
  }
  return transport;
}

/** An empty/unset SMTP_HOST is treated as "not configured" and skipped entirely, rather than
 * attempting a real connection — an empty host string otherwise triggers Node's dual-stack DNS
 * resolution delay (several seconds) before ultimately failing, which `connectionTimeout` alone
 * does not bound (that only covers the TCP connect phase, after DNS already resolved). This is the
 * expected state in most of the test suite and in any environment SMTP hasn't been configured for
 * yet — a warning is logged instead of silently doing nothing. */
function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

/** Callers MUST NOT let a rejection here fail the operation that triggered it (spec Edge Cases) —
 * the account is created regardless; a fresh one-time password can always be re-triggered. */
export async function sendOneTimePasswordEmail(to: string, otp: string): Promise<void> {
  if (!isSmtpConfigured()) {
    console.warn(`SMTP not configured — skipping one-time-password email to ${to}`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Set up your TM account",
    text: `Welcome to TM. Your one-time password is: ${otp}\n\nLog in with this password — you'll be asked to set your own right away. This one-time password expires in 72 hours.`,
  });
}

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  if (!isSmtpConfigured()) {
    console.warn(`SMTP not configured — skipping password-reset email to ${to}`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Reset your TM password",
    text: `Reset your password using this link: ${resetLink}\n\nThis link expires in 1 hour and can only be used once.`,
  });
}
