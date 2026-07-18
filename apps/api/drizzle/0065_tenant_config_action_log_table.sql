CREATE TABLE "tenant_config_action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"super_admin_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_config_action_log_entity_type_check" CHECK ("tenant_config_action_log"."entity_type" in ('role', 'department', 'custom_field'))
);
--> statement-breakpoint
ALTER TABLE "tenant_config_action_log" ADD CONSTRAINT "tenant_config_action_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_config_action_log" ADD CONSTRAINT "tenant_config_action_log_super_admin_id_super_admins_id_fk" FOREIGN KEY ("super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;