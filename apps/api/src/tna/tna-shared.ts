import { eq } from "drizzle-orm";
import { customFieldValues, formFields } from "../db/schema/custom-fields";
import type { Db } from "../db/client";

/** Shared by both the session-authenticated `/tenant/tna-assignments/*` routes
 * (tenant-tna-routes.ts) and the no-login magic-link routes (public-tna-routes.ts) — the same
 * business rules apply to a response regardless of how the caller authenticated to reach it. */
export const TNA_RESPONSE_FORM_KEY = "tna_response";

export function isExerciseOpenForSubmission(exerciseStatus: string, endDate: string): boolean {
  if (exerciseStatus !== "active") return false;
  const today = new Date().toISOString().slice(0, 10);
  return today <= endDate;
}

export async function getTnaResponseValues(tenantDb: Db, assignmentId: string): Promise<Record<string, unknown>> {
  const rows = await tenantDb
    .select({ fieldKey: formFields.fieldKey, value: customFieldValues.value })
    .from(customFieldValues)
    .innerJoin(formFields, eq(formFields.id, customFieldValues.fieldId))
    .where(eq(customFieldValues.entityId, assignmentId));
  return Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));
}
