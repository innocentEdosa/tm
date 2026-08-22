import { pgTable, uuid, text, timestamp, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";
import { departments } from "./departments";
import { tnaExercises } from "./tna-exercises";

/**
 * One resolved participant's assignment + response for a TNA exercise — materialized (snapshotted)
 * from `tna_exercise_targets` (department → manager + assistant manager; role → every current
 * holder; user → that user directly). Kept in sync on every create/edit while the exercise is still
 * a draft (so the admin sees an accurate roster before ever clicking Start), resolved once more at
 * Start itself, then frozen — never recomputed dynamically once the exercise is active or beyond.
 * This is a deliberate departure from `course_assignments`' own fully-dynamic resolution: a TNA
 * exercise is a closed, time-boxed HR exercise that needs a *stable, auditable roster* for accurate
 * completion-percentage reporting — a department/role membership change after Start must not
 * silently add or remove someone's obligation mid-campaign.
 *
 * `departmentId` records which department context this assignment came from (null for role/user-
 * sourced assignments with no department context) — a person can hold more than one assignment for
 * the same exercise if they're reachable through more than one department (e.g. manager of two
 * targeted departments), one row per department. This table only tracks *who* and *from where* —
 * the answers themselves live one level down, in `tna_responses` (child rows, since a department can
 * have more than one training need: a participant may submit any number of responses against a
 * single assignment, not just one).
 *
 * `status` here means "has this assignment received at least one submitted response" — it flips
 * `pending` -> `submitted` on the *first* `tna_responses` row submitted against it and never reverts,
 * even though more responses can still be added afterward. `submittedAt` likewise records the first
 * submission, not the latest. This is deliberately coarser than a single response's own status (see
 * `tna_responses.status`) — it exists purely for roster/completion reporting (`getProgressCounts`),
 * which only ever needs to know whether a participant has engaged at all.
 *
 * `magicLinkTokenHash` — a per-assignment secret letting the participant reach their response form
 * directly from the assignment-notification email with no login required (mirrors
 * `password_reset_tokens.token_hash`: the raw token is only ever handed to the participant once, in
 * the email; only its hash is stored, so a database leak alone can't be used to act as anyone).
 * Unlike a password-reset token this is not single-use/expiring — it stays valid for the life of the
 * assignment, since the same link must keep working across multiple save-draft visits and a final
 * submit; access to *actions* (save/submit) is still gated by `status`/the exercise's own state,
 * exactly as the session-authenticated routes already enforce.
 */
export const tnaAssignments = pgTable(
  "tna_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tnaExerciseId: uuid("tna_exercise_id")
      .notNull()
      .references((): AnyPgColumn => tnaExercises.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, { onDelete: "set null" }),
    sourceTargetType: text("source_target_type").notNull(),
    status: text("status").notNull().default("pending"),
    magicLinkTokenHash: text("magic_link_token_hash").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tna_assignments_tenant_id_exercise_id_idx").on(table.tenantId, table.tnaExerciseId),
    index("tna_assignments_tenant_id_user_id_idx").on(table.tenantId, table.userId),
    // A user can hold at most one assignment per (exercise, department) pair — resolution logic
    // dedupes role/user-sourced assignments (department_id null) against each other before insert,
    // since a plain unique index can't itself block two NULL-department rows for the same user
    // (Postgres treats NULLs as distinct).
    uniqueIndex("tna_assignments_exercise_user_department_unique").on(
      table.tnaExerciseId,
      table.userId,
      table.departmentId,
    ),
    uniqueIndex("tna_assignments_magic_link_token_hash_unique").on(table.magicLinkTokenHash),
    check("tna_assignments_source_type_check", sql`${table.sourceTargetType} in ('department', 'role', 'user')`),
    check("tna_assignments_status_check", sql`${table.status} in ('pending', 'submitted')`),
  ],
);
