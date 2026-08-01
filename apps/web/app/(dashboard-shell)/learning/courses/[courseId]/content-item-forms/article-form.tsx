"use client";

import { useState } from "react";
import { Card, Input, Button, RichTextEditor } from "@tm/ui";
import { type ContentItemTarget, type ContentItem } from "@/lib/course-api-types";
import { useAutoSaveContentItem, AutoSaveIndicator } from "./use-autosave-content-item";
import { LessonDetailsSection, LessonResourcesSection, SectionHeading } from "./lesson-form-sections";

/** The `article` content-item form — Lesson Details (title/description), Lesson Content (a rich-text
 * body, or an external URL — at least one required, matching `content-item-payload-validation.ts`'s
 * `article` shape), and Lesson Resources. Autosaves as a draft (no submit button) once a title and
 * either field are present. Pass `editingItem` to edit an already-saved article instead of authoring
 * a new one. */
export default function ArticleForm({
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
  const [body, setBody] = useState(editingItem?.payload.body ?? "");
  const [externalUrl, setExternalUrl] = useState(editingItem?.payload.externalUrl ?? "");
  const [showExternalUrl, setShowExternalUrl] = useState(Boolean(editingItem?.payload.externalUrl));
  const { status, savedItemId, scheduleSave } = useAutoSaveContentItem(courseId, target, onCreated, editingItem?.id);

  function save(next: { title: string; description: string; body: string; externalUrl: string }) {
    scheduleSave({
      type: "article",
      title: next.title,
      description: next.description || undefined,
      payload: { body: next.body || undefined, externalUrl: next.externalUrl || undefined },
    });
  }

  return (
    <Card>
      <LessonDetailsSection
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          save({ title: value, description, body, externalUrl });
        }}
        description={description}
        onDescriptionChange={(value) => {
          setDescription(value);
          save({ title, description: value, body, externalUrl });
        }}
      />

      <SectionHeading>Lesson Content</SectionHeading>
      <div className="flex flex-col gap-3">
        <div>
          <label className="field-label" htmlFor="article-body">
            Body text
          </label>
          <RichTextEditor
            id="article-body"
            defaultValue={body}
            placeholder="Write the article…"
            onChange={(html) => {
              setBody(html);
              save({ title, description, body: html, externalUrl });
            }}
          />
        </div>

        {showExternalUrl ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="field-label mb-0!" htmlFor="article-external-url">
                Or an external URL
              </label>
              <button
                type="button"
                className="cursor-pointer text-sm font-medium text-secondary hover:underline"
                onClick={() => {
                  setShowExternalUrl(false);
                  setExternalUrl("");
                  save({ title, description, body, externalUrl: "" });
                }}
              >
                Remove
              </button>
            </div>
            <Input
              id="article-external-url"
              type="url"
              value={externalUrl}
              onChange={(e) => {
                setExternalUrl(e.target.value);
                save({ title, description, body, externalUrl: e.target.value });
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="cursor-pointer self-start text-sm font-medium text-primary hover:underline"
            onClick={() => setShowExternalUrl(true)}
          >
            + Or add an external URL
          </button>
        )}
      </div>

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
