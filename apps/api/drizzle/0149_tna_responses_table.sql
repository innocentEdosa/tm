CREATE TABLE "tna_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tna_assignment_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tna_responses_status_check" CHECK ("tna_responses"."status" in ('draft', 'submitted'))
);
--> statement-breakpoint
ALTER TABLE "tna_responses" ADD CONSTRAINT "tna_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_responses" ADD CONSTRAINT "tna_responses_tna_assignment_id_tna_assignments_id_fk" FOREIGN KEY ("tna_assignment_id") REFERENCES "public"."tna_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tna_responses_tenant_id_assignment_id_idx" ON "tna_responses" USING btree ("tenant_id","tna_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tna_responses_one_draft_per_assignment_unique" ON "tna_responses" USING btree ("tna_assignment_id") WHERE "tna_responses"."status" = 'draft';