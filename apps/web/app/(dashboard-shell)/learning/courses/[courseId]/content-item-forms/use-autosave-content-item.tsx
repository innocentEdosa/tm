"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import type { ContentItemTarget, ContentItemPayload, ContentItemType } from "@/lib/course-api-types";

export type AutoSaveStatus = "idle" | "saving" | "saved";

export interface AutoSaveContentItemInput {
  type: ContentItemType;
  title: string;
  description?: string;
  payload: ContentItemPayload;
}

/**
 * Debounced create-then-update autosave for a content-item form — no "Add X" submit button; a
 * lesson is saved as a draft automatically as the admin fills in the form (no separate publish
 * step — it stays draft until published from the outline). Silently skips saving while required
 * fields aren't filled in yet (e.g. a blank title, or a video with no URL) rather than surfacing a
 * validation error on every keystroke — the item is created on the first debounce that satisfies
 * validation (real backend payload validation, `content-item-payload-validation.ts`), then later
 * debounces just PATCH it in place.
 *
 * Pass `existingId` when the form is editing an already-saved lesson rather than authoring a new
 * one — every save goes straight to a PATCH from the start, with no create call.
 */
export function useAutoSaveContentItem(courseId: string, target: ContentItemTarget, onCreated?: (id: string) => void, existingId?: string | null) {
  const api = useCourseEditorApi();
  const queryClient = useQueryClient();
  const [savedItemId, setSavedItemId] = useState<string | null>(existingId ?? null);
  const [status, setStatus] = useState<AutoSaveStatus>(existingId ? "saved" : "idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedItemIdRef = useRef<string | null>(existingId ?? null);

  function scheduleSave(input: AutoSaveContentItemInput) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus("saving");
    timeoutRef.current = setTimeout(async () => {
      const currentId = savedItemIdRef.current;
      try {
        if (currentId) {
          await api.updateContentItem(currentId, { title: input.title, description: input.description ?? null, payload: input.payload });
        } else {
          const created = await api.createContentItem(target, {
            type: input.type,
            title: input.title,
            description: input.description ?? null,
            payload: input.payload,
          });
          savedItemIdRef.current = created.id;
          setSavedItemId(created.id);
          // Lets the parent list hide this row while the form is still open editing it — otherwise the
          // freshly-created draft renders twice: once as a normal row above, once as this open form.
          onCreated?.(created.id);
        }
        setStatus("saved");
        queryClient.invalidateQueries({ queryKey: ["course-curriculum", courseId, api.cacheScope] });
        queryClient.invalidateQueries({ queryKey: ["course", courseId, api.cacheScope] });
      } catch {
        setStatus("idle");
      }
    }, 600);
  }

  return { savedItemId, status, scheduleSave };
}

export function AutoSaveIndicator({ status }: { status: AutoSaveStatus }) {
  if (status === "saving") return <span className="text-sm text-muted">Saving…</span>;
  if (status === "saved") return <span className="text-sm text-green-600">Saved</span>;
  return <span className="text-sm text-muted">Not yet saved</span>;
}
