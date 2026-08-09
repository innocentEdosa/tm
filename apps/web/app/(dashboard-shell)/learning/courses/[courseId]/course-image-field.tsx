"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { Image as ImageIcon, Upload } from "lucide-react";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import type { TenantFile } from "@/lib/course-api-types";
import { IMAGE_CONTENT_TYPES } from "@/lib/file-format";
import ExistingFilePicker from "./existing-file-picker";

/**
 * Course Details' "Course image" field. The upload/drag-and-drop box below is unchanged from before
 * this feature — same click-to-upload, same drop target, same layout — so there's zero risk of
 * regressing it. What's new is the small "Choose from existing files" trigger underneath, which opens
 * the shared `ExistingFilePicker` drawer (also used by the lesson-resource picker) scoped to
 * `IMAGE_CONTENT_TYPES` (the `course` upload allowlist) — picking one reuses it as the course image
 * with no re-upload (`POST .../image/reuse`).
 */
export default function CourseImageField({
  courseId,
  readOnly,
  courseImageUrl,
  onUpload,
  uploading,
  error,
}: {
  courseId: string;
  readOnly: boolean;
  courseImageUrl: string | null;
  onUpload: (file: File | undefined) => void;
  uploading: boolean;
  error: string | null;
}) {
  const api = useCourseEditorApi();
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reusingId, setReusingId] = useState<string | null>(null);
  const [reuseError, setReuseError] = useState<string | null>(null);

  async function handleReuse(file: TenantFile) {
    if (!api.reuseCourseImage) return;
    setReuseError(null);
    setReusingId(file.id);
    try {
      await api.reuseCourseImage(courseId, file.id);
      await queryClient.invalidateQueries({ queryKey: ["course", courseId, api.cacheScope] });
      setDrawerOpen(false);
    } catch (err) {
      setReuseError((err as Error).message);
    } finally {
      setReusingId(null);
    }
  }

  return (
    <div>
      {error && <p className="banner-error mb-2">{error}</p>}
      <input
        ref={imageInputRef}
        type="file"
        accept=".jpeg,.jpg,.png,.gif,.webp"
        className="hidden"
        onChange={(e) => {
          onUpload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {courseImageUrl ? (
        <div className="flex items-stretch gap-4">
          <div className="relative h-32 w-52 shrink-0 overflow-hidden rounded-lg border border-border">
            <Image src={courseImageUrl} alt="Course" fill sizes="208px" className="object-cover" />
          </div>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onUpload(e.dataTransfer.files?.[0]);
            }}
            disabled={readOnly || uploading}
            className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-6 py-4 text-center hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-secondary">
              <Upload className="h-4 w-4" />
            </span>
            <p className="text-sm text-secondary">
              <span className="font-semibold underline">{uploading ? "Uploading…" : "Change"}</span> {!uploading && "or drag and drop"}
            </p>
            <p className="text-xs text-muted">Recommended .jpeg, .jpg, .png, or .webp</p>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onUpload(e.dataTransfer.files?.[0]);
          }}
          disabled={readOnly || uploading}
          className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-6 py-10 text-center hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-secondary">
            <Upload className="h-4 w-4" />
          </span>
          <p className="text-sm text-secondary">
            <span className="font-semibold underline">{uploading ? "Uploading…" : "Click to upload"}</span> {!uploading && "or drag and drop"}
          </p>
          <p className="text-xs text-muted">Recommended .jpeg, .jpg, .png, or .webp</p>
        </button>
      )}

      {!readOnly && api.supportsFileManager && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="mt-2 flex w-fit cursor-pointer items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ImageIcon className="h-4 w-4" />
          Or choose from existing files
        </button>
      )}

      <ExistingFilePicker
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Choose an existing image"
        allowedContentTypes={IMAGE_CONTENT_TYPES}
        onUse={handleReuse}
        usingId={reusingId}
        error={reuseError}
      />
    </div>
  );
}
