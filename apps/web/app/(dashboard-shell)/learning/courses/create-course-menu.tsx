"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Sparkles, UploadCloud } from "lucide-react";
import { Button, Input, Modal, Popover, PopoverMenuItem } from "@tm/ui";
import { tenantFetch, uploadFileToPresignedUrl } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { Course, ContentItem } from "@/lib/course-api-types";

/**
 * The "Create a course" popover (replaces navigating straight to a full entry page) — offering
 * Generate-with-AI / Create-manually / Upload-a-SCORM-package via the shared `Popover`/`PopoverMenuItem`
 * primitives (`@tm/ui`). SCORM here creates a whole new draft course (not just a content item)
 * pre-populated from the real imported SCOs, then opens the editor.
 */
export default function CreateCourseMenu() {
  const router = useRouter();
  const subdomain = useSubdomain();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [scormModalOpen, setScormModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreateManually(close: () => void) {
    close();
    setCreateError(null);
    setCreating(true);
    try {
      const { data: course } = await tenantFetch<{ data: Course }>("/courses", {
        method: "POST",
        subdomain,
        body: { title: "Untitled course", category: "Uncategorized", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      router.push(`/learning/courses/${course.id}`);
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
            <PopoverMenuItem
              icon={<UploadCloud className="h-4 w-4" />}
              title="Upload a SCORM package"
              subtitle="Import a SCORM package as your starting content"
              onClick={() => {
                close();
                setScormModalOpen(true);
              }}
            />
          </>
        )}
      </Popover>

      <Modal open={aiModalOpen} onClose={() => setAiModalOpen(false)} title="Coming soon">
        <p className="text-sm text-secondary">
          AI course generation isn&apos;t available yet. For now, use &ldquo;Create manually&rdquo; or &ldquo;Upload a SCORM package&rdquo; to get started.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setAiModalOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>

      <ScormQuickCreateModal open={scormModalOpen} onClose={() => setScormModalOpen(false)} />
    </>
  );
}

function ScormQuickCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const subdomain = useSubdomain();
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

    try {
      const { data: course } = await tenantFetch<{ data: Course }>("/courses", {
        method: "POST",
        subdomain,
        body: { title, category: "Uncategorized", deliveryMode: "self_paced", duration: { value: 1, unit: "hours" } },
      });
      const { data: mod } = await tenantFetch<{ data: { id: string } }>(`/courses/${course.id}/modules`, {
        method: "POST",
        subdomain,
        body: { title: "Imported content" },
      });
      // The anchor content item's own payload.url is never used once a real SCORM package is
      // imported onto it (the import only cares about payload.sourceType === "scorm") — this is a
      // throwaway placeholder to satisfy the generic content-item route's payload validation, which
      // (unlike the SCORM-specific import path) always requires a non-blank url.
      const { data: anchor } = await tenantFetch<{ data: ContentItem }>(`/modules/${mod.id}/content-items`, {
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

      reset();
      onClose();
      router.push(`/learning/courses/${course.id}`);
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
