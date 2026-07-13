-- Training Needs Analysis follow-up: approval workflow (superseded the spec's own flagged
-- "no approval workflow in v1" Assumption per direct product feedback). Adds `approved_by_user_id`/
-- `approved_at` (mirrors `created_by_user_id`/`submitted_at`'s existing shape) and extends the
-- `status` CHECK to a third value, `approved`. Gated by a new, separate `tna.approve` permission
-- (0052_seed_tna_approve_permission.sql) — not `tna.manage.*` — approving is a governance action a
-- tenant may grant independently of edit/delete rights.
ALTER TABLE "training_needs" DROP CONSTRAINT "training_needs_status_check";--> statement-breakpoint
ALTER TABLE "training_needs" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "training_needs" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_needs" ADD CONSTRAINT "training_needs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_needs" ADD CONSTRAINT "training_needs_status_check" CHECK ("training_needs"."status" in ('draft', 'submitted', 'approved'));
