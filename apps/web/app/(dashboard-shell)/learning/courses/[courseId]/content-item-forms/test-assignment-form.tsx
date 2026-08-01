"use client";

import { useState } from "react";
import { Card, Button } from "@tm/ui";
import { type ContentItemTarget, type ContentItemType, type ContentItem } from "@/lib/course-api-types";
import { useAutoSaveContentItem, AutoSaveIndicator } from "./use-autosave-content-item";
import { LessonDetailsSection, LessonResourcesSection, SectionHeading } from "./lesson-form-sections";

/** Shared shell for the `test` and `assignment` placeholder-shell types — Lesson Details
 * (title/description) and Lesson Resources; no extra payload fields for Lesson Content (spec
 * FR-018, no real quiz/assessment question-builder in this spec, matching spec 024's own
 * "placeholder-shell assessments" precedent — Lesson Resources is where a real question set or
 * rubric would be attached instead). Autosaves as a draft (no submit button) once a title is
 * present. Pass `editingItem` to edit an already-saved test/assignment instead of authoring a new
 * one. */
export default function TestAssignmentForm({
  courseId,
  type,
  target,
  onClose,
  onCreated,
  editingItem,
}: {
  courseId: string;
  type: Extract<ContentItemType, "test" | "assignment">;
  target: ContentItemTarget;
  onClose: () => void;
  onCreated?: (id: string) => void;
  editingItem?: ContentItem;
}) {
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const { status, savedItemId, scheduleSave } = useAutoSaveContentItem(courseId, target, onCreated, editingItem?.id);
  const label = type === "test" ? "test" : "assignment";

  function save(next: { title: string; description: string }) {
    scheduleSave({ type, title: next.title, description: next.description || undefined, payload: {} });
  }

  return (
    <Card>
      <LessonDetailsSection
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          save({ title: value, description });
        }}
        description={description}
        onDescriptionChange={(value) => {
          setDescription(value);
          save({ title, description: value });
        }}
      />

      <SectionHeading>Lesson Content</SectionHeading>
      <p className="text-sm text-muted">
        No question builder for a {label} yet — attach a question set, answer key, or rubric under Lesson Resources below.
      </p>

      <LessonResourcesSection contentItemId={savedItemId} />

      <div className="mt-10 flex items-center gap-3">
        <Button type="button" variant="outline" onClick={onClose}>
          Done
        </Button>
        <AutoSaveIndicator status={status} />
      </div>
    </Card>
  );
}
