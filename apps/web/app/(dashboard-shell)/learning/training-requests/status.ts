export type TrainingNeedStatus = "draft" | "submitted" | "approved";

export const STATUS_LABEL: Record<TrainingNeedStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
};

// draft = not yet sent (neutral grey), submitted = awaiting approval (amber), approved = done (green)
export const STATUS_BADGE_VARIANT: Record<TrainingNeedStatus, "neutral" | "warning" | "success"> = {
  draft: "neutral",
  submitted: "warning",
  approved: "success",
};
