"use client";

import { CalendarClock } from "lucide-react";
import type { UpcomingLearningItem } from "./types";

// The panel sits beside a short filter column (search + Category/Sort) and must match its height
// exactly (`h-full`, stretched by the parent flex row) rather than grow on its own — so only as
// many items as actually fit in that height are ever shown. At the filter column's real rendered
// height (~134px), that's realistically one compact row, not a scrollable list.
const MAX_ITEMS = 1;

function formatScheduledAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function initials(name: string): string {
  const [first, second] = name.trim().split(/\s+/);
  return ((first?.[0] ?? "") + (second?.[0] ?? "")).toUpperCase() || "?";
}

function AuthorAvatar({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, no next/image domain config for it
      <img src={avatarUrl} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cta/10 text-[8px] font-semibold text-cta">
      {name ? initials(name) : "?"}
    </span>
  );
}

function LearningItemRow({ item, onSelect }: { item: UpcomingLearningItem; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-slate-50"
    >
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {item.courseImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, no next/image domain config for it
          <img src={item.courseImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <CalendarClock className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {item.scheduledAt ? (
          <span className="flex items-center gap-1 text-[9px] font-bold tracking-wide text-red-600 uppercase">
            <span className="h-1 w-1 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
            Live
          </span>
        ) : (
          <span className="text-[9px] font-bold tracking-wide text-cta uppercase">Suggested</span>
        )}
        <p className="truncate text-xs font-semibold text-primary">{item.title}</p>
        <div className="mt-0.5 flex items-center gap-1">
          <AuthorAvatar name={item.authorName} avatarUrl={item.authorAvatarUrl} />
          <span className="truncate text-[10px] text-secondary">{item.authorName ?? item.courseTitle}</span>
          {item.scheduledAt && <span className="ml-auto shrink-0 pl-1.5 text-[10px] text-secondary">{formatScheduledAt(item.scheduledAt)}</span>}
        </div>
      </div>
    </button>
  );
}

/**
 * Chronological upcoming `live_class` sessions across every assigned course — the only scheduling
 * concept that exists in the data model. When nothing is scheduled, falls back to suggesting the
 * next incomplete lesson from whichever in-progress course was most recently touched. Only shows a
 * true empty state when there's neither. `h-full` + the parent row's default flex `stretch` is what
 * keeps this panel's bottom edge aligned with the (much shorter) filter column beside it — not a
 * fixed pixel height, so it stays correct if that column's own height ever changes.
 */
export default function UpcomingLearningsPanel({
  liveClasses,
  suggestion,
  onSelectCourse,
}: {
  liveClasses: UpcomingLearningItem[];
  suggestion: UpcomingLearningItem | null;
  onSelectCourse: (courseId: string, contentItemId?: string) => void;
}) {
  const items = liveClasses.length > 0 ? liveClasses.slice(0, MAX_ITEMS) : suggestion ? [suggestion] : [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white p-4">
      <div className="mb-1.5 flex shrink-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta/10 text-cta">
          <CalendarClock className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-xs font-semibold tracking-wide text-primary uppercase">Upcoming Learnings</h2>
      </div>

      {items.length > 0 ? (
        <div className="flex flex-1 flex-col justify-center overflow-hidden">
          {items.map((item) => (
            <LearningItemRow key={item.contentItemId} item={item} onSelect={() => onSelectCourse(item.courseId, item.contentItemId)} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No upcoming learnings right now.</p>
      )}
    </div>
  );
}
