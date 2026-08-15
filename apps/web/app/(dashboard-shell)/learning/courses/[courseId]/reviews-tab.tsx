"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Button, Card, Popover, StarRating } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { CourseReview } from "@/lib/course-api-types";
import ReviewDetailDrawer from "./review-detail-drawer";

const PAGE_SIZE = 10;

type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1";
type SortOption = "newest" | "oldest" | "highest" | "lowest" | "name_asc" | "name_desc";

function ReviewerAvatar({ name }: { name: string }) {
  return <span className="shell-profile-avatar">{name.charAt(0).toUpperCase()}</span>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Performance > Reviews — course rating summary, filterable/sortable table of learner reviews with
 * flag/respond actions, and a "Show Flagged Reviews" toggle that filters the same table to
 * flagged-only. Clicking a row (or its Respond action) opens `ReviewDetailDrawer` for the full
 * Details/Your-Response experience. Backed by a real, empty-until-populated `course_reviews` table —
 * there's no learner-facing review-submission surface anywhere in this app yet, so this reads as
 * empty in practice (forward-compatible groundwork, same as the course `subcategory` column).
 */
export default function ReviewsTab({ courseId, readOnly, currentUserEmail }: { courseId: string; readOnly: boolean; currentUserEmail: string }) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();

  const reviewsQuery = useQuery({
    queryKey: ["course-reviews", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseReview[] }>(`/courses/${courseId}/reviews`, { subdomain });
      return data;
    },
  });
  const allReviews = reviewsQuery.data ?? [];

  const flagMutation = useMutation({
    mutationFn: ({ reviewId, flagged }: { reviewId: string; flagged: boolean }) =>
      tenantFetch(`/course-reviews/${reviewId}/flag`, { method: "PATCH", subdomain, body: { flagged } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course-reviews", courseId, subdomain] }),
  });

  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("newest");
  const [notAnsweredOnly, setNotAnsweredOnly] = useState(false);
  const [hasReviewOnly, setHasReviewOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  const ratingsCount = allReviews.length;
  const reviewsCount = allReviews.filter((r) => r.reviewText !== null).length;
  const courseRating = ratingsCount === 0 ? 0 : allReviews.reduce((sum, r) => sum + r.rating, 0) / ratingsCount;

  const filtered = useMemo(() => {
    let list = showFlaggedOnly ? allReviews.filter((r) => r.flagged) : allReviews;
    if (ratingFilter !== "all") list = list.filter((r) => r.rating === Number(ratingFilter));
    if (notAnsweredOnly) list = list.filter((r) => r.response === null);
    if (hasReviewOnly) list = list.filter((r) => r.reviewText !== null);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReviews.length, showFlaggedOnly, ratingFilter, notAnsweredOnly, hasReviewOnly]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortOption) {
        case "newest":
          return b.createdAt.localeCompare(a.createdAt);
        case "oldest":
          return a.createdAt.localeCompare(b.createdAt);
        case "highest":
          return b.rating - a.rating;
        case "lowest":
          return a.rating - b.rating;
        case "name_asc":
          return a.learnerName.localeCompare(b.learnerName);
        case "name_desc":
          return b.learnerName.localeCompare(a.learnerName);
      }
    });
    return copy;
  }, [filtered, sortOption]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectedReview = selectedReviewId ? (allReviews.find((r) => r.id === selectedReviewId) ?? null) : null;

  function resetPage() {
    setPage(1);
  }

  if (reviewsQuery.isError) {
    return <p className="banner-error">Couldn&apos;t load reviews. Try refreshing.</p>;
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-primary">Reviews</h2>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border px-2 text-xs font-medium text-secondary">
          {allReviews.length}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted">It can take up to 24 hours for a new rating or review to appear on your course&apos;s public page.</p>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card>
          <p className="text-sm text-muted">Course Rating</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-2xl font-bold text-primary">{courseRating.toFixed(1)}</span>
            <StarRating value={courseRating} size="md" />
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">Ratings</p>
          <p className="mt-1 text-2xl font-bold text-primary">{ratingsCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Reviews</p>
          <p className="mt-1 text-2xl font-bold text-primary">{reviewsCount}</p>
        </Card>
      </div>

      {allReviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
          <MessageSquare className="h-8 w-8 text-muted" />
          <p className="font-semibold text-primary">No reviews yet</p>
          <p className="max-w-sm text-sm text-muted">Once learners rate or review this course, they&apos;ll show up here.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="field-input h-9! w-auto!"
                value={ratingFilter}
                onChange={(e) => {
                  setRatingFilter(e.target.value as RatingFilter);
                  resetPage();
                }}
              >
                <option value="all">All ratings</option>
                <option value="5">5 stars</option>
                <option value="4">4 stars</option>
                <option value="3">3 stars</option>
                <option value="2">2 stars</option>
                <option value="1">1 star</option>
              </select>
              <select className="field-input h-9! w-auto!" value={sortOption} onChange={(e) => setSortOption(e.target.value as SortOption)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="highest">Highest rated</option>
                <option value="lowest">Lowest rated</option>
                <option value="name_asc">Name A–Z</option>
                <option value="name_desc">Name Z–A</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={notAnsweredOnly}
                  onChange={(e) => {
                    setNotAnsweredOnly(e.target.checked);
                    resetPage();
                  }}
                />
                Not Answered
              </label>
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={hasReviewOnly}
                  onChange={(e) => {
                    setHasReviewOnly(e.target.checked);
                    resetPage();
                  }}
                />
                Has Review
              </label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowFlaggedOnly((v) => !v);
                resetPage();
              }}
            >
              {showFlaggedOnly ? "Show All Reviews" : "Show Flagged Reviews"}
            </Button>
          </div>

          {sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
              <MessageSquare className="h-8 w-8 text-muted" />
              <p className="font-semibold text-primary">No matching reviews</p>
              <p className="max-w-sm text-sm text-muted">Try adjusting your filters.</p>
            </div>
          ) : (
            <>
              <table className="w-full table-fixed divide-y divide-border text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[24%]" />
                </colgroup>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Learner</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Rating</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Review</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Response</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((review) => (
                    <tr
                      key={review.id}
                      className="cursor-pointer border-t border-border hover:bg-slate-50"
                      onClick={() => setSelectedReviewId(review.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ReviewerAvatar name={review.learnerName} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-primary">{review.learnerName}</p>
                            <p className="truncate text-sm text-muted">{formatDate(review.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StarRating value={review.rating} />
                      </td>
                      <td className="px-4 py-3 text-secondary">{review.reviewText !== null ? "Yes" : "No"}</td>
                      <td className="px-4 py-3 text-secondary">{review.response !== null ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">
                        {!readOnly && (
                          <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="text-sm font-medium text-cta hover:underline"
                              onClick={() => setSelectedReviewId(review.id)}
                            >
                              Respond
                            </button>
                            {review.flagged ? (
                              <button
                                type="button"
                                className="text-sm font-medium text-secondary hover:underline"
                                onClick={() => flagMutation.mutate({ reviewId: review.id, flagged: false })}
                              >
                                Unflag
                              </button>
                            ) : (
                              <FlagConfirmPopover onConfirm={() => flagMutation.mutate({ reviewId: review.id, flagged: true })} />
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted">
                    Page {currentPage} of {totalPages}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <ReviewDetailDrawer review={selectedReview} courseId={courseId} readOnly={readOnly} currentUserEmail={currentUserEmail} onClose={() => setSelectedReviewId(null)} />
    </div>
  );
}

function FlagConfirmPopover({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Popover align="end" width={260} trigger={<span className="text-sm font-medium text-red-600 hover:underline">Flag</span>}>
      {(close) => (
        <div className="p-4">
          <p className="text-sm text-secondary">
            Are you sure? Flagging a review will hide it from your visitors but it will still count towards the overall rating.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onConfirm();
                close();
              }}
            >
              Flag
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}
