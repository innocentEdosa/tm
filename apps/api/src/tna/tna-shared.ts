import { eq, and, asc, inArray } from "drizzle-orm";
import { customFieldValues, formFields } from "../db/schema/custom-fields";
import { tnaResponses } from "../db/schema/tna-responses";
import { tnaAssignments } from "../db/schema/tna-assignments";
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

export async function getTnaResponseValues(tenantDb: Db, responseId: string): Promise<Record<string, unknown>> {
  const rows = await tenantDb
    .select({ fieldKey: formFields.fieldKey, value: customFieldValues.value })
    .from(customFieldValues)
    .innerJoin(formFields, eq(formFields.id, customFieldValues.fieldId))
    .where(eq(customFieldValues.entityId, responseId));
  return Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));
}

export interface TnaResponseRow {
  id: string;
  status: "draft" | "submitted";
  submittedAt: string | null;
  createdAt: string;
}

export interface TnaResponseWithValues extends TnaResponseRow {
  values: Record<string, unknown>;
}

/** Every response ever filed against one assignment — a department can have more than one training
 * need, so a participant may submit any number of these, not just one. Ordered oldest-first so the
 * UI can number them "Response 1", "Response 2", ... in submission order. */
export async function listTnaResponses(tenantDb: Db, assignmentId: string): Promise<TnaResponseWithValues[]> {
  const rows = await tenantDb
    .select({
      id: tnaResponses.id,
      status: tnaResponses.status,
      submittedAt: tnaResponses.submittedAt,
      createdAt: tnaResponses.createdAt,
    })
    .from(tnaResponses)
    .where(eq(tnaResponses.tnaAssignmentId, assignmentId))
    .orderBy(asc(tnaResponses.createdAt));
  if (rows.length === 0) return [];

  const valueRows = await tenantDb
    .select({ entityId: customFieldValues.entityId, fieldKey: formFields.fieldKey, value: customFieldValues.value })
    .from(customFieldValues)
    .innerJoin(formFields, eq(formFields.id, customFieldValues.fieldId))
    .where(inArray(customFieldValues.entityId, rows.map((r) => r.id)));
  const valuesByResponseId = new Map<string, Record<string, unknown>>();
  for (const row of valueRows) {
    const bucket = valuesByResponseId.get(row.entityId) ?? {};
    bucket[row.fieldKey] = row.value;
    valuesByResponseId.set(row.entityId, bucket);
  }

  return rows.map((r) => ({
    id: r.id,
    status: r.status as "draft" | "submitted",
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    values: valuesByResponseId.get(r.id) ?? {},
  }));
}

/** The one response a participant is currently filling in, if any — at most one `draft` row can
 * exist per assignment (`tna_responses_one_draft_per_assignment_unique`), since the UI only ever
 * shows one open form at a time. */
export async function getDraftResponse(tenantDb: Db, assignmentId: string): Promise<TnaResponseRow | null> {
  const [row] = await tenantDb
    .select({ id: tnaResponses.id, status: tnaResponses.status, submittedAt: tnaResponses.submittedAt, createdAt: tnaResponses.createdAt })
    .from(tnaResponses)
    .where(eq(tnaResponses.tnaAssignmentId, assignmentId));
  if (!row || row.status !== "draft") return null;
  return { id: row.id, status: "draft", submittedAt: null, createdAt: row.createdAt.toISOString() };
}

/** Starts a new response — the "Add a response" / "Add another response" action. Idempotent: if a
 * draft is already open (e.g. a double-click, or the participant never finished a prior one), that
 * same row is returned instead of erroring, matching `tna_responses_one_draft_per_assignment_unique`
 * rather than fighting it. */
export async function getOrCreateDraftResponse(tenantDb: Db, tenantId: string, assignmentId: string): Promise<TnaResponseRow> {
  const existing = await getDraftResponse(tenantDb, assignmentId);
  if (existing) return existing;
  const [created] = await tenantDb
    .insert(tnaResponses)
    .values({ tenantId, tnaAssignmentId: assignmentId })
    .returning({ id: tnaResponses.id, createdAt: tnaResponses.createdAt });
  return { id: created.id, status: "draft", submittedAt: null, createdAt: created.createdAt.toISOString() };
}

/** Confirms `responseId` is actually a still-open (`draft`) response belonging to this assignment —
 * every write route (save-progress, submit) must check this before touching it, since a stale/foreign
 * responseId or an already-submitted one must never be writable again. */
export async function getWritableResponse(tenantDb: Db, assignmentId: string, responseId: string): Promise<TnaResponseRow | null> {
  const [row] = await tenantDb
    .select({ id: tnaResponses.id, status: tnaResponses.status, tnaAssignmentId: tnaResponses.tnaAssignmentId })
    .from(tnaResponses)
    .where(eq(tnaResponses.id, responseId));
  if (!row || row.tnaAssignmentId !== assignmentId || row.status !== "draft") return null;
  return { id: row.id, status: "draft", submittedAt: null, createdAt: "" };
}

/** Marks the assignment as having engaged at all, the first time (and only the first time) one of
 * its responses is submitted — `tna_assignments.status`/`submittedAt` deliberately track "first
 * response submitted", not "latest", since they exist purely for roster/completion reporting. */
export async function markAssignmentRespondedIfFirst(tenantDb: Db, assignmentId: string): Promise<void> {
  // Scoped to `status = 'pending'` so a later response's submit is a no-op here — the update only
  // ever fires (and thus only ever sets submittedAt) the first time.
  await tenantDb
    .update(tnaAssignments)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tnaAssignments.id, assignmentId), eq(tnaAssignments.status, "pending")));
}
