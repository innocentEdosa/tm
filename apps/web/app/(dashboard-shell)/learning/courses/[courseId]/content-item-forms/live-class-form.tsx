"use client";

import { useState } from "react";
import { Card, Input, Button } from "@tm/ui";
import { type ContentItemTarget, type ContentItem } from "@/lib/course-api-types";
import { useAutoSaveContentItem, AutoSaveIndicator } from "./use-autosave-content-item";
import { LessonDetailsSection, LessonResourcesSection, SectionHeading } from "./lesson-form-sections";

/** The `live_class` content-item form — Lesson Details (title/description), Lesson Content (a single
 * required scheduled-date field, matching `content-item-payload-validation.ts`'s `live_class`
 * shape), and Lesson Resources. Autosaves as a draft (no submit button) once a title and scheduled
 * time are both present. Pass `editingItem` to edit an already-saved live class instead of
 * authoring a new one. */
export default function LiveClassForm({
  courseId,
  target,
  onClose,
  onCreated,
  editingItem,
}: {
  courseId: string;
  target: ContentItemTarget;
  onClose: () => void;
  onCreated?: (id: string) => void;
  editingItem?: ContentItem;
}) {
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [scheduledAt, setScheduledAt] = useState(editingItem?.payload.scheduledAt ?? "");
  const { status, savedItemId, scheduleSave } = useAutoSaveContentItem(courseId, target, onCreated, editingItem?.id);

  function save(next: { title: string; description: string; scheduledAt: string }) {
    scheduleSave({ type: "live_class", title: next.title, description: next.description || undefined, payload: { scheduledAt: next.scheduledAt } });
  }

  return (
    <Card>
      <LessonDetailsSection
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          save({ title: value, description, scheduledAt });
        }}
        description={description}
        onDescriptionChange={(value) => {
          setDescription(value);
          save({ title, description: value, scheduledAt });
        }}
      />

      <SectionHeading>Lesson Content</SectionHeading>
      <Input
        label="Scheduled at"
        type="datetime-local"
        value={scheduledAt}
        onChange={(e) => {
          setScheduledAt(e.target.value);
          save({ title, description, scheduledAt: e.target.value });
        }}
        required
      />

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
