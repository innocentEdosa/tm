"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Link2, Plus, Upload, X } from "lucide-react";
import { Input, Button } from "@tm/ui";
import { tenantFetch, uploadFileToPresignedUrl } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { Attachment } from "@/lib/course-api-types";

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

/** A click-or-drag file dropzone for the "Downloadable file" resource type. */
function FileDropzone({ onFileSelected, disabled }: { onFileSelected: (file: File) => void; disabled: boolean }) {
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
      <p className="text-xs text-muted">Images or PDF, up to 25 MB</p>
      <input
        ref={inputRef}
        type="file"
        accept={RESOURCE_ALLOWLIST_ACCEPT}
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
 */
export function LessonResourcesSection({ contentItemId }: { contentItemId: string | null }) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const attachmentsQuery = useQuery({
    queryKey: ["content-item-attachments", contentItemId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Attachment[] }>(`/content-items/${contentItemId}/attachments`, { subdomain });
      return data;
    },
    enabled: !!contentItemId,
  });
  const resources = attachmentsQuery.data ?? [];

  const [showAddForm, setShowAddForm] = useState(false);
  const [resourceType, setResourceType] = useState<"file" | "link">("file");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    queryClient.invalidateQueries({ queryKey: ["content-item-attachments", contentItemId, subdomain] });
  }

  async function handleFileSelected(file: File) {
    if (!contentItemId) return;
    setError(null);
    setFileName(file.name);
    setFileProgress(0);
    try {
      const { data: attachment } = await tenantFetch<{ data: { id: string; uploadUrl: string } }>(`/content-items/${contentItemId}/attachments`, {
        method: "POST",
        subdomain,
        body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      await uploadFileToPresignedUrl(attachment.uploadUrl, file, file.type, setFileProgress);
      await tenantFetch(`/attachments/${attachment.id}/confirm`, { method: "POST", subdomain });
      invalidate();
      closeAddForm();
    } catch (err) {
      setError((err as Error).message);
      setFileProgress(null);
    }
  }

  async function handleAddLink() {
    if (!contentItemId) return;
    try {
      await tenantFetch(`/content-items/${contentItemId}/attachments`, {
        method: "POST",
        subdomain,
        body: { kind: "link", fileName: linkTitle, url: linkUrl },
      });
      invalidate();
      closeAddForm();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRemove(attachmentId: string) {
    await tenantFetch(`/attachments/${attachmentId}`, { method: "DELETE", subdomain });
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
                  <option value="link">{RESOURCE_TYPE_LABEL.link}</option>
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
        </div>
      )}
    </>
  );
}
