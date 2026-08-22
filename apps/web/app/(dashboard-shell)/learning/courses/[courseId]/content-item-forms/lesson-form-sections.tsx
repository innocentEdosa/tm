"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Link2, Plus, Upload, X } from "lucide-react";
import { Input, Button } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import { uploadFileToPresignedUrl } from "@/lib/course-editor-adapter";
import type { TenantFile } from "@/lib/course-api-types";
import { CONTENT_ITEM_RESOURCE_CONTENT_TYPES } from "@/lib/file-format";
import ExistingFilePicker from "../existing-file-picker";

/** A section heading inside a lesson form — "Lesson Details" / "Lesson Content" / "Lesson Resources".
 * `first` drops the top margin for whichever section opens the form. */
export function SectionHeading({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return <p className={`${first ? "" : "mt-6"} mb-3 text-base font-semibold text-primary`}>{children}</p>;
}

/** "Lesson Details" — title + optional description, identical across every content type (spec: the
 * type-specific fields live in "Lesson Content" instead, matching each type's own `payload` shape). */
export function LessonDetailsSection({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <>
      <SectionHeading first>Lesson Details</SectionHeading>
      <div className="flex flex-col gap-3">
        <Input label="Title" value={title} onChange={(e) => onTitleChange(e.target.value)} required />
        <div>
          <label className="field-label" htmlFor="lesson-description">
            Description
          </label>
          <textarea id="lesson-description" className="field-input" rows={3} value={description} onChange={(e) => onDescriptionChange(e.target.value)} />
        </div>
      </div>
    </>
  );
}

const RESOURCE_TYPE_LABEL: Record<"file" | "link", string> = { file: "Downloadable file", link: "External link" };
const RESOURCE_ALLOWLIST_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,application/pdf";

function ResourceRow({ kind, title, onRemove }: { kind: "file" | "link"; title: string; onRemove: () => void }) {
  return (
    <li className="surface-card mb-2 flex items-center justify-between rounded-lg! px-3! py-2!">
      <div className="flex items-center gap-2">
        {kind === "file" ? <File className="h-4 w-4 shrink-0 text-secondary" /> : <Link2 className="h-4 w-4 shrink-0 text-secondary" />}
        {title}
      </div>
      <button
        type="button"
        aria-label="Remove resource"
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100"
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

/** A click-or-drag file dropzone — the "Downloadable file" resource type's own picker, generalized
 * (accept/hint text) so other upload UIs (the video-lesson upload method) reuse the exact same
 * click-or-drag mechanics and visual treatment rather than a second dropzone implementation. */
export function FileDropzone({
  onFileSelected,
  disabled,
  accept = RESOURCE_ALLOWLIST_ACCEPT,
  hint = "Images or PDF, up to 25 MB",
}: {
  onFileSelected: (file: File) => void;
  disabled: boolean;
  accept?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!disabled && file) onFileSelected(file);
      }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${isDragOver ? "border-primary bg-slate-50" : "border-border"}`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-secondary">
        <Upload className="h-4 w-4" />
      </span>
      <p className="text-sm">
        <span className="font-semibold text-primary">Click to upload</span> <span className="text-muted">or drag and drop</span>
      </p>
      <p className="text-xs text-muted">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * "Lesson Resources" — supplementary documents/links attached to a lesson, separate from the
 * lesson's own required content. Needs a real content-item id to attach to, so it stays disabled
 * (with an explanatory note) until autosave has created one from the "Lesson Details"/"Lesson
 * Content" fields above. The add-resource form is collapsed behind a "+ Add a resource" text
 * button rather than always open — it closes again as soon as a resource is added. Files go through
 * the real presigned-upload-then-confirm flow; links insert directly (no storage involved).
 *
 * `excludeAttachmentId` — a video lesson's own uploaded video is a `file_attachments` row on this
 * SAME content item (no separate table), fetched through this exact query. Without excluding it, the
 * video would also show up here as if it were just another downloadable resource; the video form
 * passes its own `payload.videoAttachmentId` here to filter it out, rather than this component
 * needing any special knowledge of video lessons itself.
 */
export function LessonResourcesSection({ contentItemId, excludeAttachmentId }: { contentItemId: string | null; excludeAttachmentId?: string | null }) {
  const api = useCourseEditorApi();
  const queryClient = useQueryClient();
  const attachmentsQuery = useQuery({
    queryKey: ["content-item-attachments", contentItemId, api.cacheScope],
    queryFn: () => api.fetchAttachments(contentItemId!),
    enabled: !!contentItemId,
  });
  const resources = (attachmentsQuery.data ?? []).filter((r) => r.id !== excludeAttachmentId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [resourceType, setResourceType] = useState<"file" | "link">("file");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reusingId, setReusingId] = useState<string | null>(null);
  // Separate from `error` above (deliberately) — the drawer's overlay covers the rest of this
  // section while open, so an error from a failed reuse must render *inside* the drawer (where it's
  // actually visible), not into the outer banner sitting behind it.
  const [reuseError, setReuseError] = useState<string | null>(null);
  const uploading = fileProgress !== null && fileProgress < 100;

  function closeAddForm() {
    setShowAddForm(false);
    setResourceType("file");
    setLinkTitle("");
    setLinkUrl("");
    setFileName(null);
    setFileProgress(null);
    setError(null);
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["content-item-attachments", contentItemId, api.cacheScope] });
  }

  async function handleFileSelected(file: File) {
    if (!contentItemId) return;
    setError(null);
    setFileName(file.name);
    setFileProgress(0);
    try {
      const attachment = await api.createAttachmentUploadUrl(contentItemId, { fileName: file.name, contentType: file.type, sizeBytes: file.size });
      await uploadFileToPresignedUrl(attachment.uploadUrl, file, file.type, setFileProgress);
      await api.confirmAttachment(contentItemId, attachment.id);
      invalidate();
      // ExistingFilePicker shares this cache key — without this, a freshly-uploaded file wouldn't show
      // up there until something else refetches it.
      queryClient.invalidateQueries({ queryKey: ["tenant-files", api.cacheScope] });
      closeAddForm();
    } catch (err) {
      setError((err as Error).message);
      setFileProgress(null);
    }
  }

  async function handleAddLink() {
    if (!contentItemId || !api.createAttachmentLink) return;
    try {
      await api.createAttachmentLink(contentItemId, { fileName: linkTitle, url: linkUrl });
      invalidate();
      closeAddForm();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUseExisting(file: TenantFile) {
    if (!contentItemId || !api.reuseAttachment) return;
    setReuseError(null);
    setReusingId(file.id);
    try {
      await api.reuseAttachment(contentItemId, file.id);
      invalidate();
      setPickerOpen(false);
      closeAddForm();
    } catch (err) {
      setReuseError((err as Error).message);
    } finally {
      setReusingId(null);
    }
  }

  async function handleRemove(attachmentId: string) {
    if (!contentItemId) return;
    await api.deleteAttachment(contentItemId, attachmentId);
    invalidate();
  }

  return (
    <>
      <SectionHeading>Lesson Resources</SectionHeading>
      <p className="mb-3 text-sm text-muted">A resource is any type of document or link that can help students in this lesson.</p>

      {!contentItemId ? (
        <p className="text-sm text-muted">Fill in the lesson details above first — resources can be added once this lesson is saved.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {resources.length > 0 && (
            <ul>
              {resources.map((r) => (
                <ResourceRow key={r.id} kind={r.kind} title={r.fileName} onRemove={() => handleRemove(r.id)} />
              ))}
            </ul>
          )}

          {error && <p className="banner-error">{error}</p>}

          {!showAddForm ? (
            <button
              type="button"
              className="flex w-fit cursor-pointer items-center gap-1 text-sm font-medium text-primary hover:underline"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4" />
              Add a resource
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <label className="field-label" htmlFor="resource-type">
                  Resource type
                </label>
                <select id="resource-type" className="field-input" value={resourceType} onChange={(e) => setResourceType(e.target.value as "file" | "link")}>
                  <option value="file">{RESOURCE_TYPE_LABEL.file}</option>
                  {api.supportsResourceLinks && <option value="link">{RESOURCE_TYPE_LABEL.link}</option>}
                </select>
              </div>

              {resourceType === "file" ? (
                <>
                  <FileDropzone onFileSelected={handleFileSelected} disabled={uploading} />
                  {fileName && fileProgress !== null && (
                    <div>
                      <p className="text-sm text-muted">{fileProgress < 100 ? `Uploading ${fileName}…` : `Added ${fileName}`}</p>
                      <div className="h-2 w-full overflow-hidden rounded bg-neutral-soft">
                        <div className="h-full bg-accent" style={{ width: `${fileProgress}%` }} />
                      </div>
                    </div>
                  )}
                  {api.supportsFileManager && (
                    <button
                      type="button"
                      className="flex w-fit cursor-pointer items-center gap-1 text-sm font-medium text-primary hover:underline"
                      onClick={() => setPickerOpen(true)}
                    >
                      <File className="h-4 w-4" />
                      Or choose from existing files
                    </button>
                  )}
                </>
              ) : (
                <>
                  <Input label="Title" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} />
                  <Input label="URL" type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                </>
              )}

              <div className="flex gap-2">
                {resourceType === "link" && (
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={handleAddLink}>
                    Add link
                  </Button>
                )}
                <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={closeAddForm}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <ExistingFilePicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title="Choose an existing file"
            allowedContentTypes={CONTENT_ITEM_RESOURCE_CONTENT_TYPES}
            onUse={handleUseExisting}
            usingId={reusingId}
            error={reuseError}
          />
        </div>
      )}
    </>
  );
}
