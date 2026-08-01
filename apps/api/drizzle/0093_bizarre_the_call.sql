CREATE TABLE "course_authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role_or_description" text,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"learner_name" text NOT NULL,
	"learner_email" text NOT NULL,
	"rating" integer NOT NULL,
	"review_text" text,
	"status" text DEFAULT 'published' NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"response_text" text,
	"response_author_name" text,
	"response_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_reviews_rating_check" CHECK ("course_reviews"."rating" between 1 and 5),
	CONSTRAINT "course_reviews_status_check" CHECK ("course_reviews"."status" in ('published', 'updated'))
);
--> statement-breakpoint
ALTER TABLE "file_attachments" DROP CONSTRAINT "file_attachments_entity_type_check";--> statement-breakpoint
ALTER TABLE "content_items" ALTER COLUMN "module_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file_attachments" ALTER COLUMN "content_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file_attachments" ALTER COLUMN "size_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file_attachments" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "learning_objectives" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "requirements" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "outline_order" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD COLUMN "kind" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_authors_tenant_id_course_id_idx" ON "course_authors" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "course_reviews_tenant_id_course_id_idx" ON "course_reviews" USING btree ("tenant_id","course_id");--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_kind_check" CHECK ("file_attachments"."kind" in ('file', 'link'));--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_kind_shape_check" CHECK (("file_attachments"."kind" = 'file' and "file_attachments"."storage_key" is not null and "file_attachments"."content_type" is not null and "file_attachments"."size_bytes" is not null and "file_attachments"."url" is null)
        or ("file_attachments"."kind" = 'link' and "file_attachments"."url" is not null and "file_attachments"."storage_key" is null and "file_attachments"."content_type" is null and "file_attachments"."size_bytes" is null));--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_entity_type_check" CHECK ("file_attachments"."entity_type" in ('content_item', 'course', 'course_author'));--> statement-breakpoint
-- Backfill outline_order for existing courses from their modules' current position order — new
-- columns default to '{}', which would otherwise silently hide every pre-existing course's modules
-- from the outline once the frontend switches to reading outlineOrder as authoritative.
UPDATE "courses" c
SET "outline_order" = coalesce(
  (SELECT array_agg(m.id::text ORDER BY m.position) FROM "course_modules" m WHERE m.course_id = c.id),
  '{}'
);