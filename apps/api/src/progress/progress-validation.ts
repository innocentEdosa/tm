export type ProgressStatus = "not_started" | "in_progress" | "completed" | "failed";

export const PROGRESS_STATUSES: ProgressStatus[] = ["not_started", "in_progress", "completed", "failed"];

const SUSPEND_DATA_MAX_LENGTH = 4096;

export interface ProgressUpdateBody {
  status?: unknown;
  scoreRaw?: unknown;
  scoreMin?: unknown;
  scoreMax?: unknown;
  bookmark?: unknown;
  suspendData?: unknown;
  sessionTimeSeconds?: unknown;
}

/**
 * research.md §6/§7: `status` is required and fixed-vocabulary; a submitted `scoreRaw` is only
 * validated against `[scoreMin, scoreMax]` when both bounds are also submitted — any other
 * combination/omission of the three score fields is valid (no other source of truth for min/max
 * exists yet). `suspendData` is capped at 4096 characters (FR-005), matching SCORM 1.2's own limit.
 */
export function validateProgressUpdate(body: ProgressUpdateBody): { error: string | null } {
  if (typeof body.status !== "string" || !PROGRESS_STATUSES.includes(body.status as ProgressStatus)) {
    return { error: `status must be one of: ${PROGRESS_STATUSES.join(", ")}` };
  }

  if (
    typeof body.scoreRaw === "number" &&
    typeof body.scoreMin === "number" &&
    typeof body.scoreMax === "number" &&
    (body.scoreRaw < body.scoreMin || body.scoreRaw > body.scoreMax)
  ) {
    return { error: "scoreRaw must fall within [scoreMin, scoreMax]" };
  }

  if (typeof body.suspendData === "string" && body.suspendData.length > SUSPEND_DATA_MAX_LENGTH) {
    return { error: `suspendData must not exceed ${SUSPEND_DATA_MAX_LENGTH} characters` };
  }

  return { error: null };
}
