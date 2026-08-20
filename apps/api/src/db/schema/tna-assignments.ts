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
 * targeted departments), one row per department. Response content itself lives in the existing
 * Custom Fields Framework (`custom_field_values`, `entityId` = this row's `id`, `formKey` =
 * `tna_response`) — this table only tracks *who*, *from where*, and *submission status*, never the
 * answers themselves, exactly mirroring how `training_needs` keeps its own fixed columns separate
 * from tenant-configurable custom-field answers.
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
