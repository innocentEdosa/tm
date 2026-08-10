CREATE TABLE "tenant_form_cta_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"form_definition_id" uuid NOT NULL,
	"cta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_form_cta_overrides_tenant_id_form_definition_id_unique" UNIQUE("tenant_id","form_definition_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_form_cta_overrides" ADD CONSTRAINT "tenant_form_cta_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_form_cta_overrides" ADD CONSTRAINT "tenant_form_cta_overrides_form_definition_id_form_definitions_id_fk" FOREIGN KEY ("form_definition_id") REFERENCES "public"."form_definitions"("id") ON DELETE cascade ON UPDATE no action;