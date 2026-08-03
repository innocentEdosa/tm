CREATE TABLE "marketplace_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform_course_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"cloned_course_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_super_admin_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_selections_status_check" CHECK ("marketplace_selections"."status" in ('requested', 'paid', 'rejected', 'fulfilled'))
);
--> statement-breakpoint
CREATE TABLE "platform_course_content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_course_id" uuid NOT NULL,
	"platform_course_module_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_super_admin_id" uuid,
	"updated_by_super_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_course_content_items_type_check" CHECK ("platform_course_content_items"."type" in ('video', 'article', 'live_class', 'test', 'assignment', 'external_import'))
);
--> statement-breakpoint
CREATE TABLE "platform_course_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_by_super_admin_id" uuid,
	"updated_by_super_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category_name" text NOT NULL,
	"delivery_mode" text NOT NULL,
	"duration_value" numeric(6, 2) NOT NULL,
	"duration_unit" text NOT NULL,
	"provider" text,
	"cost" numeric(12, 2),
	"status" text DEFAULT 'draft' NOT NULL,
	"learning_objectives" text[] DEFAULT '{}' NOT NULL,
	"requirements" text[] DEFAULT '{}' NOT NULL,
	"created_by_super_admin_id" uuid,
	"updated_by_super_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_courses_delivery_mode_check" CHECK ("platform_courses"."delivery_mode" in ('in_person', 'virtual', 'self_paced', 'blended')),
	CONSTRAINT "platform_courses_duration_unit_check" CHECK ("platform_courses"."duration_unit" in ('minutes', 'hours', 'days')),
	CONSTRAINT "platform_courses_status_check" CHECK ("platform_courses"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "platform_courses_duration_value_positive_check" CHECK ("platform_courses"."duration_value" > 0),
	CONSTRAINT "platform_courses_cost_non_negative_check" CHECK ("platform_courses"."cost" is null or "platform_courses"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_file_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_super_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_file_attachments_entity_type_check" CHECK ("platform_file_attachments"."entity_type" in ('platform_content_item')),
	CONSTRAINT "platform_file_attachments_status_check" CHECK ("platform_file_attachments"."status" in ('pending', 'ready'))
);
--> statement-breakpoint
ALTER TABLE "file_attachments" DROP CONSTRAINT "file_attachments_storage_key_unique";--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD CONSTRAINT "marketplace_selections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD CONSTRAINT "marketplace_selections_platform_course_id_platform_courses_id_fk" FOREIGN KEY ("platform_course_id") REFERENCES "public"."platform_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD CONSTRAINT "marketplace_selections_cloned_course_id_courses_id_fk" FOREIGN KEY ("cloned_course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD CONSTRAINT "marketplace_selections_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD CONSTRAINT "marketplace_selections_resolved_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("resolved_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_course_content_items" ADD CONSTRAINT "platform_course_content_items_platform_course_id_platform_courses_id_fk" FOREIGN KEY ("platform_course_id") REFERENCES "public"."platform_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_course_content_items" ADD CONSTRAINT "platform_course_content_items_platform_course_module_id_platform_course_modules_id_fk" FOREIGN KEY ("platform_course_module_id") REFERENCES "public"."platform_course_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_course_content_items" ADD CONSTRAINT "platform_course_content_items_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_course_content_items" ADD CONSTRAINT "platform_course_content_items_updated_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("updated_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_course_modules" ADD CONSTRAINT "platform_course_modules_platform_course_id_platform_courses_id_fk" FOREIGN KEY ("platform_course_id") REFERENCES "public"."platform_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_course_modules" ADD CONSTRAINT "platform_course_modules_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_course_modules" ADD CONSTRAINT "platform_course_modules_updated_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("updated_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_courses" ADD CONSTRAINT "platform_courses_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_courses" ADD CONSTRAINT "platform_courses_updated_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("updated_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ADD CONSTRAINT "platform_file_attachments_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketplace_selections_tenant_id_idx" ON "marketplace_selections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "marketplace_selections_status_idx" ON "marketplace_selections" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_selections_tenant_platform_course_active_unique" ON "marketplace_selections" USING btree ("tenant_id","platform_course_id") WHERE "marketplace_selections"."status" != 'rejected';--> statement-breakpoint
CREATE INDEX "platform_course_content_items_platform_course_id_idx" ON "platform_course_content_items" USING btree ("platform_course_id");--> statement-breakpoint
CREATE INDEX "platform_course_content_items_module_id_idx" ON "platform_course_content_items" USING btree ("platform_course_module_id");--> statement-breakpoint
CREATE INDEX "platform_course_modules_platform_course_id_idx" ON "platform_course_modules" USING btree ("platform_course_id");--> statement-breakpoint
CREATE INDEX "platform_courses_status_idx" ON "platform_courses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_courses_category_name_idx" ON "platform_courses" USING btree ("category_name");--> statement-breakpoint
CREATE INDEX "platform_file_attachments_entity_type_entity_id_idx" ON "platform_file_attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_file_attachments_storage_key_unique" ON "platform_file_attachments" USING btree ("storage_key");