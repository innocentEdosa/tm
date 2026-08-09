"use client";

import { BookOpen, CalendarClock } from "lucide-react";
import { Badge, StarRating, type BadgeProps } from "@tm/ui";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";
import type { CourseCardData, MyCourseStatus } from "./types";

/** `myCompletionDeadline` is a `YYYY-MM-DD` date-only string — parsing it with the platform default
 * timezone (`new Date("2026-08-11")` is UTC midnight) and then formatting in the viewer's local
 * timezone can roll it back a day west of UTC, so this pins both the parse and the format to UTC. */
function formatDueDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

const STATUS_LABEL: Record<MyCourseStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
};
const STATUS_VARIANT: Record<MyCourseStatus, BadgeProps["variant"]> = {
  not_started: "neutral",
  in_progress: "accent",
  completed: "success",
};
const ACTION_LABEL: Record<MyCourseStatus, string> = {
  not_started: "Start",
  in_progress: "Continue",
  completed: "Review",
};

export default function CourseCard({ data, onSelect }: { data: CourseCardData; onSelect: () => void }) {
  const { course, percent, totalItems, completedItems, status, teacherName, rating } = data;
  const description = course.description ? sanitizeRichText(course.description) : null;
  const isOverdue = status !== "completed" && !!course.myCompletionDeadline && course.myCompletionDeadline < new Date().toISOString().slice(0, 10);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-white text-left shadow-card-sm transition-shadow hover:shadow-card-md"
    >
      <div className="aspect-video w-full shrink-0 overflow-hidden bg-slate-100">
        {course.courseImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, no next/image domain config for it
          <img src={course.courseImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <BookOpen className="h-10 w-10" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 font-heading text-base font-bold text-primary">{course.title}</h3>
        {teacherName && <p className="text-sm text-secondary">{teacherName}</p>}
        {description ? (
          <div className="rich-text-content line-clamp-2 text-sm text-muted" dangerouslySetInnerHTML={{ __html: description }} />
        ) : (
          <p className="line-clamp-2 text-sm italic text-slate-400">No description available.</p>
        )}

        <div className="flex items-center gap-1.5 text-sm">
          <StarRating value={rating?.average ?? 0} />
          {rating ? (
            <>
              <span className="font-semibold text-amber-600">{rating.average.toFixed(1)}</span>
              <span className="text-slate-400">({rating.count})</span>
            </>
          ) : (
            <span className="text-slate-400">No ratings yet</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {course.category && <Badge variant="accent">{course.category.name}</Badge>}
          <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
        </div>

        {course.myCompletionDeadline && (
          <p className={`flex items-center gap-1.5 text-xs ${isOverdue ? "font-medium text-red-600" : "text-secondary"}`}>
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            {isOverdue ? "Overdue — was due" : "Due"} {formatDueDate(course.myCompletionDeadline)}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Progress</span>
            <span>
              {completedItems}/{totalItems} lessons
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-cta transition-all" style={{ width: `${percent}%` }} />
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className="btn btn-primary btn-sm mt-1 w-full"
          >
            {ACTION_LABEL[status]}
          </button>
        </div>
      </div>
    </div>
  );
}
