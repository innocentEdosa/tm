CREATE TABLE "scorm_cmi_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"interaction_index" integer NOT NULL,
	"interaction_id" text,
	"type" text,
	"weighting" numeric(12, 4),
	"student_response" text,
	"result" text,
	"latency" text,
	"correct_responses" jsonb,
	CONSTRAINT "scorm_cmi_interactions_tenant_user_content_item_index_unique" UNIQUE("tenant_id","user_id","content_item_id","interaction_index")
);
--> statement-breakpoint
CREATE TABLE "scorm_cmi_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"objective_index" integer NOT NULL,
	"objective_id" text,
	"status" text,
	"score_raw" numeric(12, 4),
	"score_min" numeric(12, 4),
	"score_max" numeric(12, 4),
	CONSTRAINT "scorm_cmi_objectives_tenant_user_content_item_index_unique" UNIQUE("tenant_id","user_id","content_item_id","objective_index")
);
--> statement-breakpoint
CREATE TABLE "scorm_package_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"manifest_item_identifier" text NOT NULL,
	"entry_point_relative_path" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scorm_package_items_content_item_id_unique" UNIQUE("content_item_id"),
	CONSTRAINT "scorm_package_items_package_id_position_unique" UNIQUE("package_id","position")
);
--> statement-breakpoint
CREATE TABLE "scorm_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scorm_cmi_interactions" ADD CONSTRAINT "scorm_cmi_interactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_cmi_interactions" ADD CONSTRAINT "scorm_cmi_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_cmi_objectives" ADD CONSTRAINT "scorm_cmi_objectives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_cmi_objectives" ADD CONSTRAINT "scorm_cmi_objectives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package_items" ADD CONSTRAINT "scorm_package_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package_items" ADD CONSTRAINT "scorm_package_items_package_id_scorm_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."scorm_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_package_items" ADD CONSTRAINT "scorm_package_items_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_packages" ADD CONSTRAINT "scorm_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_packages" ADD CONSTRAINT "scorm_packages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scorm_package_items_tenant_id_package_id_idx" ON "scorm_package_items" USING btree ("tenant_id","package_id");