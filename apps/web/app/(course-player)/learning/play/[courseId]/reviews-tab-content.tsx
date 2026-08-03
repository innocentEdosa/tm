"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { StarRating } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { CourseReview } from "@/lib/course-api-types";

type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1";

function initials(name: string): string {
  const [first, second] = name.trim().split(/\s+/);
  return ((first?.[0] ?? "") + (second?.[0] ?? "")).toUpperCase() || "?";
}

function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

const SHOW_MORE_THRESHOLD = 320;

function ReviewRow({ review }: { review: CourseReview }) {
  const [expanded, setExpanded] = useState(false);
  const text = review.reviewText ?? "";
  const isLong = text.length > SHOW_MORE_THRESHOLD;
  const shown = expanded || !isLong ? text : `${text.slice(0, SHOW_MORE_THRESHOLD)}…`;

  return (
    <div className="flex gap-3 border-b border-border py-5 last:border-b-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cta/10 text-sm font-semibold text-cta">
        {initials(review.learnerName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-primary">{review.learnerName}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <StarRating value={review.rating} size="sm" />
          <span className="text-sm text-muted">{relativeTime(review.createdAt)}</span>
        </div>
        {text && (
          <>
            <p className="mt-2 text-sm whitespace-pre-wrap text-secondary">{shown}</p>
            {isLong && (
              <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-sm font-semibold text-cta hover:underline">
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </>
        )}
        {review.response && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-primary">Response from {review.response.authorName ?? "the instructor"}</p>
            <p className="mt-1 text-sm text-secondary">{review.response.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The learner-facing Reviews tab — course rating summary + per-star distribution, then a searchable/
 * filterable review list. Adapted from the admin `reviews-tab.tsx`'s data (same `GET
 * /courses/:courseId/reviews`), but read-only and without any moderation chrome (flag/respond) —
 * those stay staff-only. Flagged reviews are excluded entirely, same as the My Courses card's own
 * rating calculation (`fetch-course-card-data.ts`).
 */
export default function ReviewsTabContent({ courseId }: { courseId: string }) {
  const subdomain = useSubdomain();
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");

  const { data: reviews, isError } = useQuery({
    queryKey: ["player-reviews", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseReview[] }>(`/courses/${courseId}/reviews`, { subdomain });
      return data;
    },
  });

  const visibleReviews = useMemo(() => (reviews ?? []).filter((r) => !r.flagged), [reviews]);

  const average = visibleReviews.length > 0 ? visibleReviews.reduce((sum, r) => sum + r.rating, 0) / visibleReviews.length : 0;

  const distribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const r of visibleReviews) counts[r.rating - 1]++;
    const total = visibleReviews.length;
    return [5, 4, 3, 2, 1].map((star) => ({ star, percent: total > 0 ? Math.round((counts[star - 1] / total) * 100) : 0 }));
  }, [visibleReviews]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleReviews
      .filter((r) => ratingFilter === "all" || r.rating === Number(ratingFilter))
      .filter((r) => !q || r.learnerName.toLowerCase().includes(q) || (r.reviewText ?? "").toLowerCase().includes(q))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [visibleReviews, search, ratingFilter]);

  if (isError) {
    return <p className="banner-error">Couldn&apos;t load reviews. Try refreshing.</p>;
  }

  if (!reviews) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-solid border-slate-300 border-t-transparent" />
      </div>
    );
  }

  if (visibleReviews.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No reviews yet.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-4 text-xl font-bold text-primary">Student feedback</h2>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex shrink-0 flex-col items-center gap-1 sm:w-40">
            <p className="text-5xl font-bold text-amber-500">{average.toFixed(1)}</p>
            <StarRating value={average} size="md" />
            <p className="text-sm font-medium text-amber-600">Course Rating</p>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            {distribution.map(({ star, percent }) => (
              <button
                key={star}
                type="button"
                onClick={() => setRatingFilter((prev) => (prev === String(star) ? "all" : (String(star) as RatingFilter)))}
                className="flex items-center gap-3 text-left"
              >
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-400" style={{ width: `${percent}%` }} />
                </div>
                <StarRating value={star} size="sm" />
                <span className={`w-10 shrink-0 text-sm ${ratingFilter === String(star) ? "font-semibold text-cta" : "text-muted"}`}>{percent}%</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-xl font-bold text-primary">Reviews</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" className="field-input pl-9" placeholder="Search reviews" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <label className="field-label sm:sr-only" htmlFor="reviews-rating-filter">
              Filter ratings
            </label>
            <select
              id="reviews-rating-filter"
              className="field-input sm:w-40"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value as RatingFilter)}
            >
              <option value="all">All ratings</option>
              <option value="5">5 stars</option>
              <option value="4">4 stars</option>
              <option value="3">3 stars</option>
              <option value="2">2 stars</option>
              <option value="1">1 star</option>
            </select>
          </div>
        </div>

        <div className="mt-2">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No reviews match your search or filter.</p>
          ) : (
            filtered.map((r) => <ReviewRow key={r.id} review={r} />)
          )}
        </div>
      </div>
    </div>
  );
}
