ALTER TABLE "platform_file_attachments" DROP CONSTRAINT "platform_file_attachments_entity_type_check";--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ALTER COLUMN "content_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ALTER COLUMN "size_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ADD COLUMN "kind" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ADD CONSTRAINT "platform_file_attachments_kind_check" CHECK ("platform_file_attachments"."kind" in ('file', 'link'));--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ADD CONSTRAINT "platform_file_attachments_kind_shape_check" CHECK (("platform_file_attachments"."kind" = 'file' and "platform_file_attachments"."storage_key" is not null and "platform_file_attachments"."content_type" is not null and "platform_file_attachments"."size_bytes" is not null and "platform_file_attachments"."url" is null)
        or ("platform_file_attachments"."kind" = 'link' and "platform_file_attachments"."url" is not null and "platform_file_attachments"."storage_key" is null and "platform_file_attachments"."content_type" is null and "platform_file_attachments"."size_bytes" is null));--> statement-breakpoint
ALTER TABLE "platform_file_attachments" ADD CONSTRAINT "platform_file_attachments_entity_type_check" CHECK ("platform_file_attachments"."entity_type" in ('platform_content_item', 'platform_course'));