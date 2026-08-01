"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Drawer, Button, Modal, Popover } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { CourseReview } from "@/lib/course-api-types";
import { StarRating } from "./star-rating";

type DetailTab = "details" | "response";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * The Reviews table's row-click detail panel — a learner's rating/review (DETAILS tab) plus posting,
 * editing, or deleting the tenant's own response (YOUR RESPONSE tab). The response's "Author" name is
 * looked up server-side from the session's own user id, never client-supplied — `currentUserEmail` is
 * accepted for prop-signature compatibility with its callers but isn't otherwise needed here.
 */
export default function ReviewDetailDrawer({
  review,
  courseId,
  readOnly,
  onClose,
}: {
  review: CourseReview | null;
  courseId: string;
  readOnly: boolean;
  currentUserEmail?: string;
  onClose: () => void;
}) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>("details");
  const [composing, setComposing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["course-reviews", courseId, subdomain] });
  }

  const flagMutation = useMutation({
    mutationFn: (flagged: boolean) => tenantFetch(`/course-reviews/${review!.id}/flag`, { method: "PATCH", subdomain, body: { flagged } }),
    onSuccess: invalidate,
  });
  const postResponseMutation = useMutation({
    mutationFn: (text: string) => tenantFetch(`/course-reviews/${review!.id}/response`, { method: "POST", subdomain, body: { text } }),
    onSuccess: invalidate,
  });
  const updateResponseMutation = useMutation({
    mutationFn: (text: string) => tenantFetch(`/course-reviews/${review!.id}/response`, { method: "PATCH", subdomain, body: { text } }),
    onSuccess: invalidate,
  });
  const deleteResponseMutation = useMutation({
    mutationFn: () => tenantFetch(`/course-reviews/${review!.id}/response`, { method: "DELETE", subdomain }),
    onSuccess: invalidate,
  });

  // Reset all per-review transient UI state whenever a different review is opened (or the drawer closes).
  useEffect(() => {
    setActiveTab("details");
    setComposing(false);
    setDraftText("");
    setToastMessage(null);
  }, [review?.id]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  if (!review) return null;

  function startComposing() {
    setDraftText(review!.response?.text ?? "");
    setComposing(true);
  }

  async function submitResponse() {
    if (!review || !draftText.trim()) return;
    const wasEdit = review.response !== null;
    try {
      await (wasEdit ? updateResponseMutation.mutateAsync(draftText) : postResponseMutation.mutateAsync(draftText));
      setComposing(false);
      setDraftText("");
      setToastMessage(wasEdit ? "Your response has been updated!" : "Your response has been published!");
    } catch {
      // The mutation's own error state isn't surfaced here beyond staying in the compose view —
      // the user can just retry the same "Post Response" click.
    }
  }

  function confirmDeleteResponse() {
    if (!review) return;
    deleteResponseMutation.mutate();
    setDeleteConfirmOpen(false);
  }

  return (
    <>
      <Drawer open={!!review} onClose={onClose} title={review.learnerName}>
        {toastMessage && <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{toastMessage}</div>}

        <div className="mb-4 flex items-center gap-3">
          <span className="shell-profile-avatar">{review.learnerName.charAt(0).toUpperCase()}</span>
          <div>
            <p className="font-semibold text-primary">{review.learnerName}</p>
            <p className="text-sm text-muted">
              {review.status === "updated" ? "Updated" : "Published"} {formatDate(review.createdAt)}
            </p>
          </div>
        </div>

        {!readOnly && (
          <div className="mb-4 flex items-center gap-2">
            {!review.response && (
              <Button size="sm" onClick={() => setActiveTab("response")}>
                Respond
              </Button>
            )}
            {review.flagged ? (
              <Button variant="outline" size="sm" onClick={() => flagMutation.mutate(false)}>
                Unflag Review
              </Button>
            ) : (
              <FlagConfirmPopover onConfirm={() => flagMutation.mutate(true)} />
            )}
          </div>
        )}

        <div className="mb-4 flex gap-6 border-b border-border">
          <button
            type="button"
            className={`-mb-px cursor-pointer border-b-2 pb-2 text-xs font-semibold tracking-wide uppercase ${
              activeTab === "details" ? "border-accent text-primary" : "border-transparent text-muted hover:text-primary"
            }`}
            onClick={() => setActiveTab("details")}
          >
            Details
          </button>
          <button
            type="button"
            className={`-mb-px cursor-pointer border-b-2 pb-2 text-xs font-semibold tracking-wide uppercase ${
              activeTab === "response" ? "border-accent text-primary" : "border-transparent text-muted hover:text-primary"
            }`}
            onClick={() => setActiveTab("response")}
          >
            Your Response
          </button>
        </div>

        {activeTab === "details" ? (
          <div className="space-y-3">
            <StarRating value={review.rating} size="md" />
            {review.reviewText ? (
              <p className="text-sm whitespace-pre-wrap text-secondary">{review.reviewText}</p>
            ) : (
              <p className="text-sm text-muted">This learner left a rating without a written review.</p>
            )}
          </div>
        ) : (
          <div>
            {composing ? (
              <div className="space-y-3">
                <textarea
                  className="field-input min-h-32 w-full"
                  placeholder="Type your response"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!draftText.trim()}
                    onClick={submitResponse}
                    isLoading={postResponseMutation.isPending || updateResponseMutation.isPending}
                  >
                    Post Response
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setComposing(false);
                      setDraftText("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : review.response ? (
              <div className="space-y-3">
                <p className="text-sm whitespace-pre-wrap text-secondary">{review.response.text}</p>
                <p className="text-sm text-muted">
                  {review.response.authorName} · {review.response.publishedAt ? formatDate(review.response.publishedAt) : ""}
                </p>
                {!readOnly && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={startComposing}>
                      Edit Response
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(true)}>
                      Delete Response
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted">You have not responded to this review.</p>
                {!readOnly && (
                  <Button size="sm" onClick={startComposing}>
                    Respond
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="Delete response?">
        <div className="space-y-4">
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to delete your response to this review?</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmDeleteResponse}>Delete</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function FlagConfirmPopover({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Popover
      align="start"
      width={260}
      trigger={
        <Button variant="outline" size="sm">
          Flag Review
        </Button>
      }
    >
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
