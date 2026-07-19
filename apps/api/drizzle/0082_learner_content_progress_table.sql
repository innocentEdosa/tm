CREATE TABLE "learner_content_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"score_raw" numeric(12, 4),
	"score_min" numeric(12, 4),
	"score_max" numeric(12, 4),
	"bookmark" text,
	"suspend_data" text,
	"session_time_seconds" integer DEFAULT 0 NOT NULL,
	"total_time_seconds" integer DEFAULT 0 NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_content_progress_tenant_user_content_item_unique" UNIQUE("tenant_id","user_id","content_item_id"),
	CONSTRAINT "learner_content_progress_status_check" CHECK ("learner_content_progress"."status" in ('not_started', 'in_progress', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "learner_content_progress" ADD CONSTRAINT "learner_content_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_content_progress" ADD CONSTRAINT "learner_content_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learner_content_progress_tenant_id_content_item_id_idx" ON "learner_content_progress" USING btree ("tenant_id","content_item_id");