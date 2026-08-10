ALTER TABLE "form_definitions" DROP CONSTRAINT "form_definitions_created_by_super_admin_id_super_admins_id_fk";
--> statement-breakpoint
ALTER TABLE "form_versions" DROP CONSTRAINT "form_versions_created_by_super_admin_id_super_admins_id_fk";
--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;