export const SCORM_LESSON_STATUSES = ["passed", "completed", "failed", "incomplete", "browsed", "not attempted"] as const;
export type ScormLessonStatus = (typeof SCORM_LESSON_STATUSES)[number];

/** Maps SCORM 1.2's 6-value `cmi.core.lesson_status` onto the Learner Progress spec's own 4-value
 * `status` vocabulary (spec 026) — used for that table's `status` column (cross-cutting rollup/review
 * features) alongside the exact raw value, which is stored separately for lossless resume. */
export function mapLessonStatusToProgressStatus(raw: string): "not_started" | "in_progress" | "completed" | "failed" {
  switch (raw) {
    case "passed":
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "incomplete":
    case "browsed":
      return "in_progress";
    case "not attempted":
    default:
      return "not_started";
  }
}
