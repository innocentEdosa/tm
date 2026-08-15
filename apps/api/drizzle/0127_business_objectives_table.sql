CREATE TABLE "business_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"priority" text NOT NULL,
	"metric_name" text NOT NULL,
	"baseline_value" numeric(14, 2),
	"target_value" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_objectives_priority_check" CHECK ("business_objectives"."priority" in ('low', 'medium', 'high')),
	CONSTRAINT "business_objectives_status_check" CHECK ("business_objectives"."status" in ('not_started', 'on_track', 'at_risk', 'done'))
);
--> statement-breakpoint
ALTER TABLE "business_objectives" ADD CONSTRAINT "business_objectives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_objectives" ADD CONSTRAINT "business_objectives_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_objectives" ADD CONSTRAINT "business_objectives_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_objectives_tenant_id_status_idx" ON "business_objectives" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "business_objectives_tenant_id_due_date_idx" ON "business_objectives" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "business_objectives_tenant_id_owner_user_id_idx" ON "business_objectives" USING btree ("tenant_id","owner_user_id");