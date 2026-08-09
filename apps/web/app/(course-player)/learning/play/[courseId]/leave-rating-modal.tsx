"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal, StarRating, Button } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { CourseReview } from "@/lib/course-api-types";

const RATING_LABEL: Record<number, string> = {
  1: "Not for me",
  2: "Could be better",
  3: "Average, could be better",
  4: "Pretty good",
  5: "Loved it!",
};

/**
 * "Leave a rating" — a 2-step flow (pick a star count, then optionally write feedback), matching
 * Udemy's own. Submits through `POST /courses/:courseId/reviews`, which upserts on the caller's own
 * (courseId, userId) — a learner always has at most one review per course, editing it in place on a
 * second visit rather than creating a duplicate. When `myReview` is already set, the modal opens
 * straight to the feedback step, pre-filled, since the rating step's only purpose is picking a first
 * value.
 */
export default function LeaveRatingModal({
  open,
  onClose,
  courseId,
  myReview,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  myReview: CourseReview | null;
}) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"rating" | "feedback">("rating");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!open) return;
    if (myReview) {
      setRating(myReview.rating);
      setText(myReview.reviewText ?? "");
      setStep("feedback");
    } else {
      setRating(0);
      setText("");
      setStep("rating");
    }
  }, [open, myReview]);

  const submit = useMutation({
    mutationFn: async () => {
      await tenantFetch(`/courses/${courseId}/reviews?asLearner=true`, { method: "POST", subdomain, body: { rating, reviewText: text || null } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-reviews", courseId, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["player-my-review", courseId, subdomain] });
      onClose();
    },
  });

  function pickRating(value: number) {
    setRating(value);
    setStep("feedback");
  }

  return (
    <Modal open={open} onClose={onClose} title={step === "rating" ? "How would you rate this course?" : "Why did you leave this rating?"}>
      {step === "rating" ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <p className="text-sm font-semibold tracking-wide text-secondary uppercase">Select Rating</p>
          <StarRating value={rating} size="lg" interactive onChange={pickRating} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <button type="button" onClick={() => setStep("rating")} className="w-fit text-sm font-semibold text-cta hover:underline">
            Back
          </button>

          <div className="flex flex-col items-center gap-3">
            {rating > 0 && <p className="text-sm font-semibold text-secondary">{RATING_LABEL[rating]}</p>}
            <StarRating value={rating} size="lg" interactive onChange={setRating} />
          </div>

          <textarea
            className="field-input min-h-[120px]"
            placeholder="Tell us about your own personal experience taking this course. Was it a good match for you?"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {submit.isError && <p className="banner-error">Couldn&apos;t save your rating. Try again.</p>}

          <div className="flex justify-end">
            <Button onClick={() => submit.mutate()} isLoading={submit.isPending} disabled={rating === 0}>
              Save and Continue
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
