-- Tenant-owned steps/sections (Form Builder spec follow-up: "the tenant can have sections and
-- steps too, it just only affects their tenant") — extends form_steps/form_sections with the
-- same dual-ownership shape form_fields already uses (formVersionId set = platform-owned,
-- tenantId set = tenant-owned, never both). formDefinitionId is added as a direct column (a
-- tenant-owned row has no formVersionId to derive it through) — nullable first, backfilled from
-- the existing formVersionId -> form_versions.form_definition_id relationship, then locked to
-- NOT NULL, since drizzle-kit's own generated ALTER (adding it NOT NULL in one step) would fail
-- against this table's existing rows.

ALTER TABLE "form_sections" ALTER COLUMN "form_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "form_steps" ALTER COLUMN "form_version_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "form_sections" ADD COLUMN "form_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "form_sections" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "form_steps" ADD COLUMN "form_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "form_steps" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint

UPDATE "form_sections" SET "form_definition_id" = "form_versions"."form_definition_id"
  FROM "form_versions" WHERE "form_versions"."id" = "form_sections"."form_version_id";--> statement-breakpoint
UPDATE "form_steps" SET "form_definition_id" = "form_versions"."form_definition_id"
  FROM "form_versions" WHERE "form_versions"."id" = "form_steps"."form_version_id";--> statement-breakpoint

ALTER TABLE "form_sections" ALTER COLUMN "form_definition_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "form_steps" ALTER COLUMN "form_definition_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_form_definition_id_form_definitions_id_fk" FOREIGN KEY ("form_definition_id") REFERENCES "public"."form_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_steps" ADD CONSTRAINT "form_steps_form_definition_id_form_definitions_id_fk" FOREIGN KEY ("form_definition_id") REFERENCES "public"."form_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_steps" ADD CONSTRAINT "form_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_tenant_id_form_definition_id_key_unique" UNIQUE("tenant_id","form_definition_id","key");--> statement-breakpoint
ALTER TABLE "form_steps" ADD CONSTRAINT "form_steps_tenant_id_form_definition_id_key_unique" UNIQUE("tenant_id","form_definition_id","key");--> statement-breakpoint

ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_ownership_check" CHECK (("form_sections"."form_version_id" IS NOT NULL AND "form_sections"."tenant_id" IS NULL) OR ("form_sections"."form_version_id" IS NULL AND "form_sections"."tenant_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "form_steps" ADD CONSTRAINT "form_steps_ownership_check" CHECK (("form_steps"."form_version_id" IS NOT NULL AND "form_steps"."tenant_id" IS NULL) OR ("form_steps"."form_version_id" IS NULL AND "form_steps"."tenant_id" IS NOT NULL));
