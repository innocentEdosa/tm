CREATE TABLE "form_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_version_id" uuid NOT NULL,
	"form_step_id" uuid,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_sections_form_version_id_key_unique" UNIQUE("form_version_id","key")
);
--> statement-breakpoint
CREATE TABLE "form_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_steps_form_version_id_key_unique" UNIQUE("form_version_id","key"),
	CONSTRAINT "form_steps_form_version_id_display_order_unique" UNIQUE("form_version_id","display_order")
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_definition_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"layout_config" jsonb,
	"created_by_super_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "form_versions_form_definition_id_version_number_unique" UNIQUE("form_definition_id","version_number"),
	CONSTRAINT "form_versions_status_check" CHECK ("form_versions"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "form_fields" DROP CONSTRAINT "form_fields_field_type_check";--> statement-breakpoint
ALTER TABLE "form_field_order_overrides" ALTER COLUMN "display_order" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD COLUMN "form_version_id" uuid;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN "active_version_id" uuid;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN "created_by_super_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "form_field_order_overrides" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "form_version_id" uuid;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "form_section_id" uuid;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "placeholder" text;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "default_value" jsonb;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "validation" jsonb;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "layout" jsonb;--> statement-breakpoint
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_form_step_id_form_steps_id_fk" FOREIGN KEY ("form_step_id") REFERENCES "public"."form_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_steps" ADD CONSTRAINT "form_steps_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_definition_id_form_definitions_id_fk" FOREIGN KEY ("form_definition_id") REFERENCES "public"."form_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_active_version_id_form_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_created_by_super_admin_id_super_admins_id_fk" FOREIGN KEY ("created_by_super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_section_id_form_sections_id_fk" FOREIGN KEY ("form_section_id") REFERENCES "public"."form_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_status_check" CHECK ("form_definitions"."status" IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_field_type_check" CHECK ("form_fields"."field_type" IN ('text', 'textarea', 'number', 'email', 'url', 'date', 'datetime', 'select', 'multiselect', 'radio', 'checkbox', 'toggle', 'file'));