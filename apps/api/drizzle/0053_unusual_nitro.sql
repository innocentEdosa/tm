CREATE TABLE "tenant_action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"super_admin_id" uuid,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deletion_purge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_action_log" ADD CONSTRAINT "tenant_action_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_action_log" ADD CONSTRAINT "tenant_action_log_super_admin_id_super_admins_id_fk" FOREIGN KEY ("super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;