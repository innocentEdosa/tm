"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Input, Button } from "@tm/ui";
import { tenantFetch, uploadFileToPresignedUrl } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import { type ContentItemTarget, type ContentItem } from "@/lib/course-api-types";
import { useAutoSaveContentItem, AutoSaveIndicator } from "./use-autosave-content-item";
import { LessonDetailsSection, LessonResourcesSection, SectionHeading } from "./lesson-form-sections";

type SubChoice = "url" | "scorm";

/**
 * The `external_import` content-item form — a sub-choice between a plain external URL and a real
 * SCORM 1.2 package upload (upload-url → PUT bytes → import, spec 027). SCORM upload always needs a
 * real module (the real import is module-scoped) — the SCORM tab is hidden when adding a standalone
 * lesson (`target` has no `moduleId`).
 *
 * Only the URL sub-choice gets the Lesson Details/Content/Resources structure and autosaves (once a
 * title and URL are both present) — SCORM is a bulk multi-SCO import, not a single lesson being
 * authored, so it keeps its own simpler create-then-upload-then-import flow with nothing to attach
 * resources to.
 *
 * Pass `editingItem` to edit an already-saved external-import lesson instead of authoring a new
 * one — the sub-choice toggle is hidden and the form always shows the URL fields, since re-running a
 * SCORM import doesn't make sense for an item that already exists (and isn't supported by the real
 * import route, which rejects re-importing once a learner has launched the package).
 */
export default function ExternalImportForm({
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
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const [subChoice, setSubChoice] = useState<SubChoice>("url");
  const { status, savedItemId, scheduleSave } = useAutoSaveContentItem(courseId, target, onCreated, editingItem?.id);

  // Plain URL sub-choice state
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [url, setUrl] = useState(editingItem?.payload.url ?? "");
  const [sourceType, setSourceType] = useState(editingItem?.payload.sourceType ?? "link");

  // SCORM upload sub-choice state
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [scormError, setScormError] = useState<string | null>(null);

  function save(next: { title: string; description: string; url: string; sourceType: string }) {
    scheduleSave({ type: "external_import", title: next.title, description: next.description || undefined, payload: { url: next.url, sourceType: next.sourceType } });
  }

  async function handleScormFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!("moduleId" in target)) return;
    const file = event.target.files?.[0];
    if (!file) return;
    setScormError(null);
    setFileName(file.name);
    setProgress(0);
    try {
      // The anchor content item's own payload.url is never used once a real SCORM package is
      // imported onto it (import only cares about payload.sourceType === "scorm") — this is a
      // throwaway placeholder to satisfy the generic content-item route's payload validation.
      const { data: anchor } = await tenantFetch<{ data: ContentItem }>(`/modules/${target.moduleId}/content-items`, {
        method: "POST",
        subdomain,
        body: { type: "external_import", title: file.name.replace(/\.zip$/i, ""), payload: { url: "pending", sourceType: "scorm" } },
      });
      const { data: upload } = await tenantFetch<{ data: { uploadUrl: string; storageKey: string } }>(
        `/content-items/${anchor.id}/scorm/upload-url`,
        { method: "POST", subdomain, body: { sizeBytes: file.size } },
      );
      await uploadFileToPresignedUrl(upload.uploadUrl, file, "application/zip", setProgress);
      await tenantFetch(`/content-items/${anchor.id}/scorm/import`, { method: "POST", subdomain, body: { storageKey: upload.storageKey } });
      await queryClient.invalidateQueries({ queryKey: ["course-curriculum", courseId, subdomain] });
      onClose();
    } catch (err) {
      setScormError((err as Error).message);
      setProgress(null);
    }
  }

  return (
    <Card>
      {!editingItem && "moduleId" in target && (
        <div className="mb-3 flex gap-2">
          <Button type="button" variant={subChoice === "url" ? "primary" : "outline"} size="sm" onClick={() => setSubChoice("url")}>
            External URL
          </Button>
          <Button type="button" variant={subChoice === "scorm" ? "primary" : "outline"} size="sm" onClick={() => setSubChoice("scorm")}>
            Upload a SCORM package
          </Button>
        </div>
      )}

      {editingItem || subChoice === "url" || !("moduleId" in target) ? (
        <>
          <LessonDetailsSection
            title={title}
            onTitleChange={(value) => {
              setTitle(value);
              save({ title: value, description, url, sourceType });
            }}
            description={description}
            onDescriptionChange={(value) => {
              setDescription(value);
              save({ title, description: value, url, sourceType });
            }}
          />

          <SectionHeading>Lesson Content</SectionHeading>
          <div className="flex flex-col gap-3">
            <Input
              label="URL"
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                save({ title, description, url: e.target.value, sourceType });
              }}
              required
            />
            <Input
              label="Source type"
              value={sourceType}
              onChange={(e) => {
                setSourceType(e.target.value);
                save({ title, description, url, sourceType: e.target.value });
              }}
              required
            />
          </div>

          <LessonResourcesSection contentItemId={savedItemId} />

          <div className="mt-10 flex items-center gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
            <AutoSaveIndicator status={status} />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {scormError && <p className="banner-error">{scormError}</p>}
          <Input type="file" accept=".zip" onChange={handleScormFileChange} disabled={progress !== null && progress < 100} />
          {fileName && progress !== null && (
            <div>
              <p className="text-sm text-muted">{progress < 100 ? `Uploading ${fileName}…` : `Imported ${fileName}`}</p>
              <div className="h-2 w-full overflow-hidden rounded bg-neutral-soft">
                <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Card>
  );
}
