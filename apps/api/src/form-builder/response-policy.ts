import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions } from "../db/schema/custom-fields";

/**
 * Reads a form type's `allow_multiple_responses` policy flag (multiple form responses feature).
 * A thin, single-column lookup — deliberately not routed through `getEffectiveForm`, which also
 * resolves steps/sections/fields a caller checking only this flag (e.g. before an insert) doesn't
 * need. Returns `false` (the safe, single-response default) when the form type doesn't exist,
 * mirroring `getEffectiveForm`'s own "unknown form type degrades gracefully" convention (spec 033
 * Edge Cases) rather than throwing.
 *
 * Enforcement itself is each consuming feature's own responsibility (spec 033 FR-031 — the Form
 * Builder never persists submissions) — this only answers "is multiple allowed for this form
 * type", the same way any other feature would call it, e.g.:
 *
 *   if (!(await getAllowMultipleResponses(db, "training_needs_analysis"))) {
 *     // look up whether this respondent already has a response; reject a second one if so
 *   }
 */
export async function getAllowMultipleResponses(db: Db, formKey: string): Promise<boolean> {
  const [definition] = await db
    .select({ allowMultipleResponses: formDefinitions.allowMultipleResponses })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, formKey));
  return definition?.allowMultipleResponses ?? false;
}
