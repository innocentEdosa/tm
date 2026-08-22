"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Film, Monitor, Play, RotateCw, Upload, Video as VideoIcon, X } from "lucide-react";
import { Card, Input, Button, Modal } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import { uploadVideoFile, UploadCancelledError } from "@/lib/video-upload";
import { formatFileSize } from "@/lib/file-format";
import { type ContentItemTarget, type ContentItem } from "@/lib/course-api-types";
import { useAutoSaveContentItem, AutoSaveIndicator } from "./use-autosave-content-item";
import { LessonDetailsSection, LessonResourcesSection, SectionHeading, FileDropzone } from "./lesson-form-sections";

type VideoMethod = "url" | "upload" | "record-video" | "record-screen";
type UploadState = "idle" | "uploading" | "uploaded" | "error";

const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";
const VIDEO_HINT = "MP4, WebM, or MOV — up to 5 GB";

function VideoMethodCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg bg-slate-50 px-4 py-10 text-center hover:bg-slate-100"
    >
      <span className="text-secondary">{icon}</span>
      <span className="text-sm font-medium text-primary">{label}</span>
    </button>
  );
}

/** The `video` content-item form — first asks how the video should be added (matching the design's
 * method picker), then supports two real methods: a video URL (autosaves through the normal
 * create-then-update flow, like every other content type) and uploading a file (large-file-aware:
 * `uploadVideoFile` transparently picks single-PUT vs. multipart based on size). "Record a
 * video"/"Record your screen" still have no real media-capture backing this app doesn't have, so they
 * keep showing "coming soon".
 *
 * The upload method deliberately doesn't reuse `useAutoSaveContentItem` — that hook creates the
 * content item lazily, the first time its payload happens to validate on a debounced keystroke, which
 * doesn't fit "create the anchor row the instant a file is picked, then upload to it" (mirrors
 * `external-import-form.tsx`'s own SCORM sub-mode, which has exactly the same shape). Title/description
 * edits during upload mode go through a small local debounce instead, once the anchor row exists.
 */
export default function VideoForm({
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
  const api = useCourseEditorApi();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<VideoMethod | null>(editingItem ? (editingItem.payload.videoAttachmentId ? "upload" : "url") : null);
  const [comingSoonOpen, setComingSoonOpen] = useState(false);
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [description, setDescription] = useState(editingItem?.description ?? "");

  // ---- "Use a video URL" method state (unchanged from before file upload existed) ----
  const [url, setUrl] = useState(editingItem?.payload.url ?? "");
  const { status, savedItemId, scheduleSave } = useAutoSaveContentItem(courseId, target, onCreated, editingItem?.id);

  function saveUrl(next: { title: string; description: string; url: string }) {
    scheduleSave({ type: "video", title: next.title, description: next.description || undefined, payload: { url: next.url } });
  }

  // ---- "Upload a file" method state ----
  const [uploadContentItemId, setUploadContentItemId] = useState<string | null>(editingItem?.id ?? null);
  const [uploadSaveStatus, setUploadSaveStatus] = useState<"idle" | "saving" | "saved">(editingItem ? "saved" : "idle");
  const [videoAttachmentId, setVideoAttachmentId] = useState<string | null>(editingItem?.payload.videoAttachmentId ?? null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>(editingItem?.payload.videoAttachmentId ? "uploaded" : "idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const detailsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const inFlightAttachmentIdRef = useRef<string | null>(null);

  // Shares its cache entry with `LessonResourcesSection`'s own identical query — one real fetch, not
  // two — so an already-uploaded video (editing an existing lesson, not just-picked in this session)
  // shows its real file name/size instead of falling back to "Video uploaded".
  const attachmentsQuery = useQuery({
    queryKey: ["content-item-attachments", uploadContentItemId, api.cacheScope],
    queryFn: () => api.fetchAttachments(uploadContentItemId!),
    enabled: !!uploadContentItemId,
  });
  const videoAttachment = attachmentsQuery.data?.find((a) => a.id === videoAttachmentId) ?? null;

  function invalidateAfterUploadChange(contentItemId: string) {
    queryClient.invalidateQueries({ queryKey: ["content-item-attachments", contentItemId, api.cacheScope] });
    queryClient.invalidateQueries({ queryKey: ["course-curriculum", courseId, api.cacheScope] });
    queryClient.invalidateQueries({ queryKey: ["course", courseId, api.cacheScope] });
  }

  function scheduleDetailsSave(nextTitle: string, nextDescription: string) {
    if (!uploadContentItemId) return; // nothing to save until the anchor row exists (created on file pick)
    if (detailsDebounceRef.current) clearTimeout(detailsDebounceRef.current);
    setUploadSaveStatus("saving");
    detailsDebounceRef.current = setTimeout(async () => {
      try {
        await api.updateContentItem(uploadContentItemId, { title: nextTitle, description: nextDescription || null });
        setUploadSaveStatus("saved");
      } catch {
        setUploadSaveStatus("idle");
      }
    }, 600);
  }

  async function ensureUploadContentItem(fallbackTitle: string): Promise<string> {
    if (uploadContentItemId) return uploadContentItemId;
    const created = await api.createContentItem(target, {
      type: "video",
      title: title.trim() || fallbackTitle,
      description: description || undefined,
      payload: { uploadPending: true },
    });
    setUploadContentItemId(created.id);
    setUploadSaveStatus("saved");
    onCreated?.(created.id);
    return created.id;
  }

  async function handleFileSelected(file: File) {
    setUploadError(null);
    setPickedFile(file);
    setUploadState("uploading");
    setUploadProgress(0);
    cancelledRef.current = false;
    inFlightAttachmentIdRef.current = null;
    try {
      const contentItemId = await ensureUploadContentItem(file.name.replace(/\.[^./\\]+$/, ""));
      const result = await uploadVideoFile(api, contentItemId, file, {
        onProgress: setUploadProgress,
        isCancelled: () => cancelledRef.current,
        onAttachmentIdKnown: (id) => {
          inFlightAttachmentIdRef.current = id;
        },
      });
      setVideoAttachmentId(result.attachmentId);
      setUploadState("uploaded");
      invalidateAfterUploadChange(contentItemId);
    } catch (err) {
      if (err instanceof UploadCancelledError) {
        setUploadState("idle");
        setPickedFile(null);
        const abandonedId = inFlightAttachmentIdRef.current;
        if (abandonedId && api.abortVideoUpload) {
          await api.abortVideoUpload(abandonedId).catch(() => {});
        }
        return;
      }
      setUploadError((err as Error).message);
      setUploadState("error");
    }
  }

  function handleCancel() {
    cancelledRef.current = true;
  }

  function handleRetry() {
    if (pickedFile) handleFileSelected(pickedFile);
  }

  function pickMethod(next: VideoMethod) {
    if (next === "url") {
      setMethod(next);
      return;
    }
    if (next === "upload" && api.supportsVideoUpload) {
      setMethod(next);
      return;
    }
    setComingSoonOpen(true);
  }

  if (method === null) {
    return (
      <Card>
        <SectionHeading first>How would you like to add this video?</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <VideoMethodCard icon={<Play className="h-6 w-6" />} label="Use a video URL" onClick={() => pickMethod("url")} />
          <VideoMethodCard icon={<Upload className="h-6 w-6" />} label="Upload a file" onClick={() => pickMethod("upload")} />
          <VideoMethodCard icon={<VideoIcon className="h-6 w-6" />} label="Record a video" onClick={() => pickMethod("record-video")} />
          <VideoMethodCard icon={<Monitor className="h-6 w-6" />} label="Record your screen" onClick={() => pickMethod("record-screen")} />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <Modal open={comingSoonOpen} onClose={() => setComingSoonOpen(false)} title="Coming soon">
          <p className="text-sm text-secondary">This way of adding a video isn&apos;t available yet. For now, use a video URL{api.supportsVideoUpload ? " or upload a file" : ""}.</p>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setComingSoonOpen(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      </Card>
    );
  }

  if (method === "upload") {
    return (
      <Card>
        {!editingItem && (
          <button type="button" onClick={() => setMethod(null)} className="mb-3 flex cursor-pointer items-center gap-1 text-sm text-secondary hover:text-primary">
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        )}

        <LessonDetailsSection
          title={title}
          onTitleChange={(value) => {
            setTitle(value);
            scheduleDetailsSave(value, description);
          }}
          description={description}
          onDescriptionChange={(value) => {
            setDescription(value);
            scheduleDetailsSave(title, value);
          }}
        />

        <SectionHeading>Lesson Content</SectionHeading>
        <div className="flex flex-col gap-3">
          {uploadState === "idle" && <FileDropzone onFileSelected={handleFileSelected} disabled={false} accept={VIDEO_ACCEPT} hint={VIDEO_HINT} />}

          {uploadState === "uploading" && pickedFile && (
            <div className="surface-card flex flex-col gap-2 rounded-lg! p-4!">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-primary">
                  <Film className="h-4 w-4 shrink-0 text-secondary" />
                  <span className="truncate">{pickedFile.name}</span>
                </span>
                <button type="button" aria-label="Cancel upload" className="shrink-0 text-secondary hover:text-primary" onClick={handleCancel}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-neutral-soft">
                <div className="h-full bg-accent transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
              <p className="text-xs text-muted">Uploading… {uploadProgress}%</p>
            </div>
          )}

          {uploadState === "error" && pickedFile && (
            <div className="flex flex-col gap-2">
              <p className="banner-error">{uploadError}</p>
              <div className="surface-card flex items-center justify-between rounded-lg! px-3! py-2!">
                <span className="flex min-w-0 items-center gap-2 text-sm text-primary">
                  <Film className="h-4 w-4 shrink-0 text-secondary" />
                  <span className="truncate">{pickedFile.name}</span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
                  <RotateCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {uploadState === "uploaded" && (
            <div className="flex flex-col gap-2">
              <div className="surface-card flex items-center justify-between rounded-lg! px-3! py-2!">
                <span className="flex min-w-0 items-center gap-2 text-sm text-primary">
                  <Film className="h-4 w-4 shrink-0 text-secondary" />
                  <span className="truncate">{videoAttachment?.fileName ?? pickedFile?.name ?? "Video uploaded"}</span>
                  <span className="shrink-0 text-xs text-muted">{formatFileSize(videoAttachment?.sizeBytes ?? pickedFile?.size ?? null)}</span>
                </span>
              </div>
              <button
                type="button"
                className="flex w-fit cursor-pointer items-center gap-1 text-sm font-medium text-primary hover:underline"
                onClick={() => {
                  setUploadState("idle");
                  setPickedFile(null);
                }}
              >
                Replace video
              </button>
            </div>
          )}
        </div>

        <LessonResourcesSection contentItemId={uploadContentItemId} excludeAttachmentId={videoAttachmentId} />

        <div className="mt-10 flex items-center gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
          <AutoSaveIndicator status={uploadSaveStatus} />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <button type="button" onClick={() => setMethod(null)} className="mb-3 flex cursor-pointer items-center gap-1 text-sm text-secondary hover:text-primary">
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      <LessonDetailsSection
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          saveUrl({ title: value, description, url });
        }}
        description={description}
        onDescriptionChange={(value) => {
          setDescription(value);
          saveUrl({ title, description: value, url });
        }}
      />

      <SectionHeading>Lesson Content</SectionHeading>
      <Input
        label="Video URL"
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          saveUrl({ title, description, url: e.target.value });
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
