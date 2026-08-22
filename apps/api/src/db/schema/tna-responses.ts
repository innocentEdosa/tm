import { pgTable, uuid, text, timestamp, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tnaAssignments } from "./tna-assignments";

/**
 * One filled-out TNA response, child of `tna_assignments` — a department can have more than one
 * training need, so a single assignment (one roster slot for one participant) may accumulate many
 * of these over the life of the exercise rather than exactly one. Response content itself still
 * lives in the Custom Fields Framework (`custom_field_values`, `entityId` = this row's `id`,
 * `formKey` = `tna_response`), exactly as `tna_assignments` used to hold it directly before this
 * table existed (see `0150_backfill_tna_responses.sql` for the one-time migration of pre-existing
 * assignment-keyed values onto their own response row).
 *
 * `status` mirrors `tna_assignments.status`'s old pending/submitted shape but scoped to one
 * response: `draft` while the participant is still filling it in, `submitted` once locked — never
 * reopened afterward (no reopen workflow exists anywhere in this feature). At most one `draft` row
 * may exist per assignment at a time (`tna_responses_one_draft_per_assignment_unique`) — the UI only
 * ever shows one open form at once; a participant finishes or the deadline passes before starting
 * another. `tna_assignments.status` itself now means "has at least one submitted response" (flips to
 * `submitted` once, on the first response's submit, and never reverts even though more responses can
 * still be added afterward) rather than "the one response is submitted".
 */
export const tnaResponses = pgTable(
  "tna_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tnaAssignmentId: uuid("tna_assignment_id")
      .notNull()
      .references((): AnyPgColumn => tnaAssignments.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tna_responses_tenant_id_assignment_id_idx").on(table.tenantId, table.tnaAssignmentId),
    uniqueIndex("tna_responses_one_draft_per_assignment_unique")
      .on(table.tnaAssignmentId)
      .where(sql`${table.status} = 'draft'`),
    check("tna_responses_status_check", sql`${table.status} in ('draft', 'submitted')`),
  ],
);
