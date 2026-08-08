import { buildCourseUpdateAvailableEmail } from "../mail/email-templates";
import { sendMail } from "../mail/send-mail";

/**
 * Course Marketplace Updates (spec 032, research.md §8) — sent once per tenant per newly-notified
 * platform course version, from `record-platform-course-change.ts`'s notify routine. Built on the
 * same shared `sendMail` guarantee-wrapper every other transactional email in this codebase uses —
 * never fails/blocks its caller (research.md §6).
 */
export async function sendCourseUpdateAvailableEmail(to: string, courseTitle: string, manageUrl: string): Promise<void> {
  const { subject, text, html } = buildCourseUpdateAvailableEmail({ courseTitle, manageUrl });
  await sendMail({ to, subject, text, html });
}
