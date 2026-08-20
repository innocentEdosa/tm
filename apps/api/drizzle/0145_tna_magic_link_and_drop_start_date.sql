-- Training Needs Analysis follow-up:
--   1. Drops `tna_exercises.start_date` — HR only ever configures a deadline (`end_date`) at
--      creation now; the exercise's actual start is `started_at`, already recorded automatically
--      when HR clicks Start.
--   2. Adds `tna_assignments.magic_link_token_hash` — a per-assignment secret letting a participant
--      reach their response form directly from the assignment email with no login required (mirrors
--      `password_reset_tokens.token_hash`: hashed at rest, raw value only ever handed out once, in
--      the email). Added nullable first, backfilled for every already-live assignment row (there is
--      no email to resend for these — a placeholder value keyed off a random UUID + high-precision
--      timestamp is inert by construction, never matching any token this migration didn't itself
--      generate), then locked to NOT NULL — the standard add-nullable/backfill/constrain sequence for
--      a NOT NULL column on a table that may already hold rows.
ALTER TABLE "tna_assignments" ADD COLUMN "magic_link_token_hash" text;--> statement-breakpoint
UPDATE "tna_assignments" SET "magic_link_token_hash" = md5(gen_random_uuid()::text || clock_timestamp()::text) WHERE "magic_link_token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "tna_assignments" ALTER COLUMN "magic_link_token_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tna_assignments_magic_link_token_hash_unique" ON "tna_assignments" USING btree ("magic_link_token_hash");--> statement-breakpoint
ALTER TABLE "tna_exercises" DROP COLUMN "start_date";
