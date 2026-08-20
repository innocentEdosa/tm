-- Only Objective (title), Owner (owner_department_id), and Target Completion Date (due_date) are
-- actually required to create a Business Objective — category and metric/KPI become optional, and
-- priority keeps its always-present default now that it's no longer treated as a hard requirement.
ALTER TABLE "business_objectives" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "business_objectives" ALTER COLUMN "priority" SET DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "business_objectives" ALTER COLUMN "metric_name" DROP NOT NULL;