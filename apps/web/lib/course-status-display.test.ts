import { describe, expect, it } from "vitest";
import { CONTENT_STATUS_LABEL, CONTENT_STATUS_DOT, CONTENT_STATUS_BADGE_VARIANT } from "./course-status-display";
import type { ContentStatus } from "./course-api-types";

const ALL_STATUSES: ContentStatus[] = ["draft", "published", "archived"];

describe("course-status-display — archived is a first-class, visually distinct state", () => {
  it("every status has a label, dot color, and badge variant", () => {
    for (const status of ALL_STATUSES) {
      expect(CONTENT_STATUS_LABEL[status]).toBeTruthy();
      expect(CONTENT_STATUS_DOT[status]).toBeTruthy();
      expect(CONTENT_STATUS_BADGE_VARIANT[status]).toBeTruthy();
    }
  });

  it("archived renders as 'Archived', not blank, undefined, or a draft/published label", () => {
    expect(CONTENT_STATUS_LABEL.archived).toBe("Archived");
    expect(CONTENT_STATUS_LABEL.archived).not.toBe(CONTENT_STATUS_LABEL.draft);
    expect(CONTENT_STATUS_LABEL.archived).not.toBe(CONTENT_STATUS_LABEL.published);
  });

  it("archived is visually distinct from draft and published — not treated as either", () => {
    expect(CONTENT_STATUS_DOT.archived).not.toBe(CONTENT_STATUS_DOT.draft);
    expect(CONTENT_STATUS_DOT.archived).not.toBe(CONTENT_STATUS_DOT.published);
    expect(CONTENT_STATUS_BADGE_VARIANT.archived).not.toBe(CONTENT_STATUS_BADGE_VARIANT.draft);
    expect(CONTENT_STATUS_BADGE_VARIANT.archived).not.toBe(CONTENT_STATUS_BADGE_VARIANT.published);
  });
});
