"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Sparkles, UploadCloud } from "lucide-react";
import { Button, Input, Modal, Popover, PopoverMenuItem } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import { uploadFileToPresignedUrl } from "@/lib/course-editor-adapter";

/**
 * The "Create a course" popover (replaces navigating straight to a full entry page) — offering
 * Generate-with-AI / Create-manually / Upload-a-SCORM-package via the shared `Popover`/`PopoverMenuItem`
 * primitives (`@tm/ui`). SCORM here creates a whole new draft course (not just a content item)
 * pre-populated from the real imported SCOs, then opens the editor.
 */
export default function CreateCourseMenu({ editorBasePath = "/learning/courses" }: { editorBasePath?: string }) {
  const router = useRouter();
  const api = useCourseEditorApi();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [scormModalOpen, setScormModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreateManually(close: () => void) {
    close();
    setCreateError(null);
    setCreating(true);
    try {
      const course = await api.createDraftCourse({ title: "Untitled course" });
      router.push(`${editorBasePath}/${course.id}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {createError && <p className="banner-error mb-2">{createError}</p>}
      <Popover
        width={380}
        trigger={
          <Button disabled={creating}>
            <Plus className="h-4 w-4" />
            Create a course
          </Button>
        }
      >
        {(close) => (
          <>
            <PopoverMenuItem
              hero
              icon={<Sparkles className="h-4 w-4" />}
              title="Generate with AI"
              subtitle="Create a course draft with the power of AI"
              onClick={() => {
                close();
                setAiModalOpen(true);
              }}
            />
            <PopoverMenuItem
              icon={<FileText className="h-4 w-4" />}
              title="Create manually"
              subtitle="Set up course details, then build your curriculum"
              onClick={() => handleCreateManually(close)}
            />
            {api.supportsScormImport && (
              <PopoverMenuItem
                icon={<UploadCloud className="h-4 w-4" />}
                title="Upload a SCORM package"
                subtitle="Import a SCORM package as your starting content"
                onClick={() => {
                  close();
                  setScormModalOpen(true);
                }}
              />
            )}
          </>
        )}
      </Popover>

      <Modal open={aiModalOpen} onClose={() => setAiModalOpen(false)} title="Coming soon">
        <p className="text-sm text-secondary">
          AI course generation isn&apos;t available yet. For now, use &ldquo;Create manually&rdquo;
          {api.supportsScormImport && <> or &ldquo;Upload a SCORM package&rdquo;</>} to get started.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setAiModalOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>

      {api.supportsScormImport && (
        <ScormQuickCreateModal open={scormModalOpen} onClose={() => setScormModalOpen(false)} editorBasePath={editorBasePath} />
      )}
    </>
  );
}

function ScormQuickCreateModal({ open, onClose, editorBasePath }: { open: boolean; onClose: () => void; editorBasePath: string }) {
  const router = useRouter();
  const api = useCourseEditorApi();
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setFileName(null);
    setProgress(null);
    setError(null);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setError(null);
    setFileName(file.name);
    setProgress(0);

    if (!api.getScormUploadUrl || !api.importScormPackage) return;
    try {
      const course = await api.createDraftCourse({ title });
      const mod = await api.createModule(course.id, { title: "Imported content", description: "" });
      // The anchor content item's own payload.url is never used once a real SCORM package is
      // imported onto it (the import only cares about payload.sourceType === "scorm") — this is a
      // throwaway placeholder to satisfy the generic content-item route's payload validation, which
      // (unlike the SCORM-specific import path) always requires a non-blank url.
      const anchor = await api.createContentItem(
        { moduleId: mod.id },
        { type: "external_import", title: file.name.replace(/\.zip$/i, ""), payload: { url: "pending", sourceType: "scorm" } },
      );

      const upload = await api.getScormUploadUrl(anchor.id, file.size);
      await uploadFileToPresignedUrl(upload.uploadUrl, file, "application/zip", setProgress);
      await api.importScormPackage(anchor.id, upload.storageKey);

      reset();
      onClose();
      router.push(`${editorBasePath}/${course.id}`);
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  }

  const uploading = progress !== null && progress < 100;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (uploading) return;
        reset();
        onClose();
      }}
      title="Upload a SCORM package"
    >
      <div className="flex flex-col gap-3">
        {error && <p className="banner-error">{error}</p>}
        <Input label="Course title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={uploading} required />
        <Input type="file" accept=".zip" onChange={handleFileChange} disabled={!title.trim() || uploading} />
        {fileName && progress !== null && (
          <div>
            <p className="text-sm text-muted">{progress < 100 ? `Uploading ${fileName}…` : `Imported ${fileName}`}</p>
            <div className="h-2 w-full overflow-hidden rounded bg-neutral-soft">
              <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              if (uploading) return;
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
