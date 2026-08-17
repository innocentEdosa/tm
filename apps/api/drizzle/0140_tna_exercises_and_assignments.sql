CREATE TABLE "tna_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tna_exercise_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid,
	"source_target_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tna_assignments_source_type_check" CHECK ("tna_assignments"."source_target_type" in ('department', 'role', 'user')),
	CONSTRAINT "tna_assignments_status_check" CHECK ("tna_assignments"."status" in ('pending', 'submitted'))
);
--> statement-breakpoint
CREATE TABLE "tna_exercise_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tna_exercise_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"department_id" uuid,
	"role_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tna_exercise_targets_type_check" CHECK ("tna_exercise_targets"."target_type" in ('department', 'role', 'user')),
	CONSTRAINT "tna_exercise_targets_shape_check" CHECK (("tna_exercise_targets"."target_type" = 'department' and "tna_exercise_targets"."department_id" is not null and "tna_exercise_targets"."role_id" is null and "tna_exercise_targets"."user_id" is null)
        or ("tna_exercise_targets"."target_type" = 'role' and "tna_exercise_targets"."role_id" is not null and "tna_exercise_targets"."department_id" is null and "tna_exercise_targets"."user_id" is null)
        or ("tna_exercise_targets"."target_type" = 'user' and "tna_exercise_targets"."user_id" is not null and "tna_exercise_targets"."department_id" is null and "tna_exercise_targets"."role_id" is null))
);
--> statement-breakpoint
CREATE TABLE "tna_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"targets_all_departments" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"committed_by_user_id" uuid,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tna_exercises_status_check" CHECK ("tna_exercises"."status" in ('draft', 'active', 'closed', 'under_review', 'committed'))
);
--> statement-breakpoint
ALTER TABLE "tna_assignments" ADD CONSTRAINT "tna_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_assignments" ADD CONSTRAINT "tna_assignments_tna_exercise_id_tna_exercises_id_fk" FOREIGN KEY ("tna_exercise_id") REFERENCES "public"."tna_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_assignments" ADD CONSTRAINT "tna_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_assignments" ADD CONSTRAINT "tna_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercise_targets" ADD CONSTRAINT "tna_exercise_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercise_targets" ADD CONSTRAINT "tna_exercise_targets_tna_exercise_id_tna_exercises_id_fk" FOREIGN KEY ("tna_exercise_id") REFERENCES "public"."tna_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercise_targets" ADD CONSTRAINT "tna_exercise_targets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercise_targets" ADD CONSTRAINT "tna_exercise_targets_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercise_targets" ADD CONSTRAINT "tna_exercise_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercises" ADD CONSTRAINT "tna_exercises_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercises" ADD CONSTRAINT "tna_exercises_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tna_exercises" ADD CONSTRAINT "tna_exercises_committed_by_user_id_users_id_fk" FOREIGN KEY ("committed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tna_assignments_tenant_id_exercise_id_idx" ON "tna_assignments" USING btree ("tenant_id","tna_exercise_id");--> statement-breakpoint
CREATE INDEX "tna_assignments_tenant_id_user_id_idx" ON "tna_assignments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tna_assignments_exercise_user_department_unique" ON "tna_assignments" USING btree ("tna_exercise_id","user_id","department_id");--> statement-breakpoint
CREATE INDEX "tna_exercise_targets_tenant_id_exercise_id_idx" ON "tna_exercise_targets" USING btree ("tenant_id","tna_exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tna_exercise_targets_exercise_department_unique" ON "tna_exercise_targets" USING btree ("tna_exercise_id","department_id") WHERE "tna_exercise_targets"."department_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tna_exercise_targets_exercise_role_unique" ON "tna_exercise_targets" USING btree ("tna_exercise_id","role_id") WHERE "tna_exercise_targets"."role_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tna_exercise_targets_exercise_user_unique" ON "tna_exercise_targets" USING btree ("tna_exercise_id","user_id") WHERE "tna_exercise_targets"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "tna_exercises_tenant_id_status_idx" ON "tna_exercises" USING btree ("tenant_id","status");