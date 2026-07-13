-- Training Needs Analysis spec (014): creates `training_needs` — schema only, no RLS/grants yet
-- (0046/0047). Deliberately minimal fixed field set (`title`, `priority`, `department_id`,
-- `status`) — everything else is a tenant-configured custom field through the existing Custom
-- Fields Framework (Spec 010), never a column here (research.md §5, spec Clarifications).
--
-- NOTE: `drizzle-kit generate` also proposed re-adding `users.invited_by`/`users.archived_at` and
-- their FK here — those already exist (0039_add_users_invited_by.sql,
-- 0044_add_users_archived_at.sql were hand-authored and never re-synced into a drizzle-kit
-- snapshot until this migration's own `0045_snapshot.json`). Removed from this file since applying
-- them again would fail with "column already exists"; the snapshot itself is correct going forward.
CREATE TABLE "training_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"title" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_needs_priority_check" CHECK ("training_needs"."priority" in ('low', 'medium', 'high')),
	CONSTRAINT "training_needs_status_check" CHECK ("training_needs"."status" in ('draft', 'submitted'))
);
--> statement-breakpoint
ALTER TABLE "training_needs" ADD CONSTRAINT "training_needs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_needs" ADD CONSTRAINT "training_needs_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_needs" ADD CONSTRAINT "training_needs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_needs_tenant_id_department_id_idx" ON "training_needs" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "training_needs_tenant_id_status_idx" ON "training_needs" USING btree ("tenant_id","status");
