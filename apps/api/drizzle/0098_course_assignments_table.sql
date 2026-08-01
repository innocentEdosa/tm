CREATE TABLE "course_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"assignee_type" text NOT NULL,
	"user_id" uuid,
	"department_id" uuid,
	"role_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_assignments_assignee_type_check" CHECK ("course_assignments"."assignee_type" in ('all', 'user', 'department', 'role')),
	CONSTRAINT "course_assignments_target_shape_check" CHECK (("course_assignments"."assignee_type" = 'all' and "course_assignments"."user_id" is null and "course_assignments"."department_id" is null and "course_assignments"."role_id" is null)
        or ("course_assignments"."assignee_type" = 'user' and "course_assignments"."user_id" is not null and "course_assignments"."department_id" is null and "course_assignments"."role_id" is null)
        or ("course_assignments"."assignee_type" = 'department' and "course_assignments"."department_id" is not null and "course_assignments"."user_id" is null and "course_assignments"."role_id" is null)
        or ("course_assignments"."assignee_type" = 'role' and "course_assignments"."role_id" is not null and "course_assignments"."user_id" is null and "course_assignments"."department_id" is null))
);
--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_assignments_tenant_id_course_id_idx" ON "course_assignments" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "course_assignments_tenant_id_user_id_idx" ON "course_assignments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "course_assignments_tenant_id_department_id_idx" ON "course_assignments" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "course_assignments_tenant_id_role_id_idx" ON "course_assignments" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_assignments_course_all_unique" ON "course_assignments" USING btree ("course_id") WHERE "course_assignments"."assignee_type" = 'all';--> statement-breakpoint
CREATE UNIQUE INDEX "course_assignments_course_user_unique" ON "course_assignments" USING btree ("course_id","user_id") WHERE "course_assignments"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_assignments_course_department_unique" ON "course_assignments" USING btree ("course_id","department_id") WHERE "course_assignments"."department_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_assignments_course_role_unique" ON "course_assignments" USING btree ("course_id","role_id") WHERE "course_assignments"."role_id" is not null;