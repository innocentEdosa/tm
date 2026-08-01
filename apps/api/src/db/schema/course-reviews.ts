import { pgTable, uuid, text, integer, boolean, timestamp, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { courses } from "./courses";

/**
 * A tenant-scoped learner rating/review of a course (data-model addition for the course-editor
 * "Reviews" panel). Built as real, forward-compatible groundwork alongside this wiring pass — there is
 * no learner-facing review-submission surface anywhere in this app yet, so this table has no creation
 * endpoint and reads as empty until a future spec adds one. `reviewText` is nullable: a rating-only
 * entry counts toward the rating average but not the review count. `flagged` hides a review from any
 * future public-facing page without deleting it (moderation only).
 */
export const courseReviews = pgTable(
  "course_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => courses.id, { onDelete: "cascade" }),
    learnerName: text("learner_name").notNull(),
    learnerEmail: text("learner_email").notNull(),
    rating: integer("rating").notNull(),
    reviewText: text("review_text"),
    status: text("status").notNull().default("published"),
    flagged: boolean("flagged").notNull().default(false),
    responseText: text("response_text"),
    responseAuthorName: text("response_author_name"),
    responsePublishedAt: timestamp("response_published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("course_reviews_tenant_id_course_id_idx").on(table.tenantId, table.courseId),
    check("course_reviews_rating_check", sql`${table.rating} between 1 and 5`),
    check("course_reviews_status_check", sql`${table.status} in ('published', 'updated')`),
  ],
);
