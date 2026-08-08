ALTER TABLE "content_items" ADD COLUMN "source_platform_course_content_item_id" uuid;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "source_platform_course_module_id" uuid;--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD COLUMN "applied_platform_course_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD COLUMN "notified_platform_course_version" integer;--> statement-breakpoint
ALTER TABLE "marketplace_selections" ADD COLUMN "dismissed_platform_course_version" integer;--> statement-breakpoint
ALTER TABLE "platform_courses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_source_platform_course_content_item_id_platform_course_content_items_id_fk" FOREIGN KEY ("source_platform_course_content_item_id") REFERENCES "public"."platform_course_content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_source_platform_course_module_id_platform_course_modules_id_fk" FOREIGN KEY ("source_platform_course_module_id") REFERENCES "public"."platform_course_modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_items_source_platform_course_content_item_id_idx" ON "content_items" USING btree ("source_platform_course_content_item_id");--> statement-breakpoint
CREATE INDEX "course_modules_source_platform_course_module_id_idx" ON "course_modules" USING btree ("source_platform_course_module_id");