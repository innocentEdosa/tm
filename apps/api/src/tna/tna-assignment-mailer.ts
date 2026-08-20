import { buildTnaAssignmentEmail } from "../mail/email-templates";
import { sendMail } from "../mail/send-mail";

/**
 * Training Needs Analysis — sent once per participant, from the `/start` route right after their
 * `tna_assignments` row is created. Built on the same shared `sendMail` guarantee-wrapper every other
 * transactional email in this codebase uses — never fails/blocks the Start action that triggered it.
 */
export async function sendTnaAssignmentEmail(to: string, exerciseTitle: string, endDate: string, respondUrl: string): Promise<void> {
  const { subject, text, html } = buildTnaAssignmentEmail({ exerciseTitle, endDate, respondUrl });
  await sendMail({ to, subject, text, html });
}
