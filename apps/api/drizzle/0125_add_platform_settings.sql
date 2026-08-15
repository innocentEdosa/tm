CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_super_admin_id" uuid
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("updated_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;