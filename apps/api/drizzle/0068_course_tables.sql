CREATE TABLE "course_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_template_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_category_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_category_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category_id" uuid NOT NULL,
	"delivery_mode" text NOT NULL,
	"duration_value" numeric(6, 2) NOT NULL,
	"duration_unit" text NOT NULL,
	"provider" text,
	"cost" numeric(12, 2),
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_delivery_mode_check" CHECK ("courses"."delivery_mode" in ('in_person', 'virtual', 'self_paced', 'blended')),
	CONSTRAINT "courses_duration_unit_check" CHECK ("courses"."duration_unit" in ('minutes', 'hours', 'days')),
	CONSTRAINT "courses_status_check" CHECK ("courses"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "courses_duration_value_positive_check" CHECK ("courses"."duration_value" > 0),
	CONSTRAINT "courses_cost_non_negative_check" CHECK ("courses"."cost" is null or "courses"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_source_template_id_course_category_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."course_category_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_course_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."course_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_categories_tenant_id_name_unique" ON "course_categories" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "courses_tenant_id_status_idx" ON "courses" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "courses_tenant_id_category_id_idx" ON "courses" USING btree ("tenant_id","category_id");