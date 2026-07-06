ALTER TABLE "departments" DROP CONSTRAINT "departments_tenant_id_name_unique";--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "parent_department_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "assistant_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_department_id_departments_id_fk" FOREIGN KEY ("parent_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_assistant_manager_id_users_id_fk" FOREIGN KEY ("assistant_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_tenant_id_name_unique" ON "departments" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_status_check" CHECK ("departments"."status" in ('active', 'archived'));