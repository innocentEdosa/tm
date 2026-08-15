-- Hand-written (drizzle-kit's interactive rename-resolution prompt has no TTY in this environment)
-- — covers the same diff drizzle-kit would otherwise produce for this schema change:
--
-- 1. New tenant-owned category catalog for business objectives (resolve-or-create-by-name pattern,
--    mirrors course_categories exactly) — business_objectives.category (a fixed 8-value enum) is
--    dropped in favor of a category_id FK into this new table, so a caller can search existing
--    categories or create a new one inline instead of picking from a closed list.
-- 2. business_objectives.owner_user_id is dropped in favor of owner_department_id — the objective
--    owner is now a responsible department, not an individual user.
--
-- Both are genuine drop+add (not renames): the column type/semantics and referenced table change,
-- not just the name. Table is confirmed empty in every environment this has been applied to so far,
-- so the new NOT NULL columns need no backfill.

CREATE TABLE "business_objective_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_objective_categories" ADD CONSTRAINT "business_objective_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_objective_categories" ADD CONSTRAINT "business_objective_categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "business_objective_categories_tenant_id_name_unique" ON "business_objective_categories" USING btree ("tenant_id", lower("name"));
--> statement-breakpoint

ALTER TABLE "business_objectives" DROP CONSTRAINT "business_objectives_category_check";
--> statement-breakpoint
ALTER TABLE "business_objectives" DROP COLUMN "category";
--> statement-breakpoint
ALTER TABLE "business_objectives" ADD COLUMN "category_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_objectives" ADD CONSTRAINT "business_objectives_category_id_business_objective_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."business_objective_categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "business_objectives_tenant_id_category_id_idx" ON "business_objectives" USING btree ("tenant_id","category_id");
--> statement-breakpoint

ALTER TABLE "business_objectives" DROP CONSTRAINT "business_objectives_owner_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "business_objectives_tenant_id_owner_user_id_idx";
--> statement-breakpoint
ALTER TABLE "business_objectives" DROP COLUMN "owner_user_id";
--> statement-breakpoint
ALTER TABLE "business_objectives" ADD COLUMN "owner_department_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_objectives" ADD CONSTRAINT "business_objectives_owner_department_id_departments_id_fk" FOREIGN KEY ("owner_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "business_objectives_tenant_id_owner_department_id_idx" ON "business_objectives" USING btree ("tenant_id","owner_department_id");
