ALTER TABLE "content_items" DROP CONSTRAINT "content_items_status_check";--> statement-breakpoint
ALTER TABLE "course_modules" DROP CONSTRAINT "course_modules_status_check";--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_status_check" CHECK ("content_items"."status" in ('draft', 'published', 'archived'));--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_status_check" CHECK ("course_modules"."status" in ('draft', 'published', 'archived'));