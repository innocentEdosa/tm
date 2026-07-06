CREATE TABLE "form_field_order_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"form_definition_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_field_order_overrides_tenant_id_field_id_unique" UNIQUE("tenant_id","field_id")
);
--> statement-breakpoint
ALTER TABLE "form_fields" DROP CONSTRAINT "form_fields_created_by_check";--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "form_field_order_overrides" ADD CONSTRAINT "form_field_order_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_field_order_overrides" ADD CONSTRAINT "form_field_order_overrides_form_definition_id_form_definitions_id_fk" FOREIGN KEY ("form_definition_id") REFERENCES "public"."form_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_field_order_overrides" ADD CONSTRAINT "form_field_order_overrides_field_id_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_created_by_check" CHECK ("form_fields"."created_by" IN ('super_admin', 'tenant_admin', 'system'));