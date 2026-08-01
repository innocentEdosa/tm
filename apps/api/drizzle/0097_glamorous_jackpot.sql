ALTER TABLE "content_items" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_status_check" CHECK ("content_items"."status" in ('draft', 'published'));--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_status_check" CHECK ("course_modules"."status" in ('draft', 'published'));