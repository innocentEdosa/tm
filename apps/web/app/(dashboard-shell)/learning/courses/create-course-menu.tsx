"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileText, Layers, ListChecks, Plus, Route, Sparkles, UploadCloud } from "lucide-react";
import { Button, Input, Modal } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import { uploadFileToPresignedUrl } from "@/lib/course-editor-adapter";

type ContentType = "course" | "quiz_assignment" | "learning_path";
type CourseMethod = "ai" | "manual" | "scorm";

const CONTENT_TYPES: { id: ContentType; icon: ReactNode; iconBg: string; title: string; description: string }[] = [
  {
    id: "course",
    icon: <Layers className="h-4 w-4" />,
    iconBg: "bg-indigo-600",
    title: "Course",
    description: "Create and publish educational content for learners.",
  },
  {
    id: "quiz_assignment",
    icon: <ListChecks className="h-4 w-4" />,
    iconBg: "bg-blue-600",
    title: "Quiz/Assignment",
    description: "Create an assessment or assignment for learners to complete.",
  },
  {
    id: "learning_path",
    icon: <Route className="h-4 w-4" />,
    iconBg: "bg-violet-600",
    title: "Learning path",
    description: "Create a structured and sequenced journey for learners to follow.",
  },
];

const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  course: "Course",
  quiz_assignment: "Quiz/Assignment",
  learning_path: "Learning path",
};

function ContentTypeCard({
  icon,
  iconBg,
  title,
  description,
  selected,
  onClick,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-5 text-left transition-colors ${
        selected ? "border-cta bg-cta/5" : "border-border hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${iconBg}`}>{icon}</span>
        <span className="font-semibold text-primary">{title}</span>
      </span>
      <span className="text-sm text-muted">{description}</span>
    </button>
  );
}

/**
 * The "Add Content" flow — a "Create new content" type picker (Course / Quiz-Assignment / Learning
 * path) shown first; only Course is backed by real functionality today, so picking it opens a second
 * step with the actual creation methods (Generate with AI / Create manually / Upload a SCORM
 * package, unchanged from before this picker existed). The other two types have no backend concept
 * yet (no standalone quiz/assignment or learning-path entity), so they route to a "coming soon" note
 * instead of pretending to work — same convention as every other unbuilt entry point in this feature
 * (e.g. the AI modal below, `content-item-type-picker.tsx`'s own AI option).
 */
export default function CreateCourseMenu({
  editorBasePath = "/learning/courses",
  manualCreateHref,
}: {
  editorBasePath?: string;
  /** When set, "Create manually" navigates here (the fullscreen create-course page) instead of
   * immediately creating an "Untitled course" draft and jumping straight into the tabbed editor.
   * Left unset for platform course-marketplace authoring, which keeps the old inline quick-create
   * behavior for now. */
  manualCreateHref?: string;
}) {
  const router = useRouter();
  const api = useCourseEditorApi();
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ContentType | null>(null);
  const [courseMethodModalOpen, setCourseMethodModalOpen] = useState(false);
  const [selectedCourseMethod, setSelectedCourseMethod] = useState<CourseMethod | null>(null);
  const [comingSoonType, setComingSoonType] = useState<ContentType | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [scormModalOpen, setScormModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function openTypeModal() {
    setSelectedType(null);
    setTypeModalOpen(true);
  }

  function handleContinue() {
    if (!selectedType) return;
    setTypeModalOpen(false);
    if (selectedType === "course") {
      setSelectedCourseMethod(null);
      setCourseMethodModalOpen(true);
    } else {
      setComingSoonType(selectedType);
    }
  }

  function handleCourseMethodContinue() {
    if (!selectedCourseMethod) return;
    setCourseMethodModalOpen(false);
    if (selectedCourseMethod === "ai") {
      setAiModalOpen(true);
    } else if (selectedCourseMethod === "manual") {
      if (manualCreateHref) {
        router.push(manualCreateHref);
      } else {
        handleCreateManually();
      }
    } else {
      setScormModalOpen(true);
    }
  }

  async function handleCreateManually() {
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
      <Button disabled={creating} onClick={openTypeModal}>
        <Plus className="h-4 w-4" />
        Add Content
      </Button>

      <Modal open={typeModalOpen} onClose={() => setTypeModalOpen(false)} title="Create new content" size="lg">
        <div className="flex min-h-[420px] flex-col">
          <div className="grid flex-1 grid-cols-1 content-start gap-4 sm:grid-cols-2">
            {CONTENT_TYPES.map((type) => (
              <ContentTypeCard
                key={type.id}
                icon={type.icon}
                iconBg={type.iconBg}
                title={type.title}
                description={type.description}
                selected={selectedType === type.id}
                onClick={() => setSelectedType(type.id)}
              />
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={handleContinue} disabled={!selectedType}>
              Continue
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={courseMethodModalOpen} onClose={() => setCourseMethodModalOpen(false)} title="Create a course" size="lg">
        <div className="flex min-h-[420px] flex-col">
          <div className="grid flex-1 grid-cols-1 content-start gap-4 sm:grid-cols-2">
            <ContentTypeCard
              icon={<Sparkles className="h-4 w-4" />}
              iconBg="bg-fuchsia-600"
              title="Generate with AI"
              description="Create a course draft with the power of AI"
              selected={selectedCourseMethod === "ai"}
              onClick={() => setSelectedCourseMethod("ai")}
            />
            <ContentTypeCard
              icon={<FileText className="h-4 w-4" />}
              iconBg="bg-emerald-600"
              title="Create manually"
              description="Set up course details, then build your curriculum"
              selected={selectedCourseMethod === "manual"}
              onClick={() => setSelectedCourseMethod("manual")}
            />
            {api.supportsScormImport && (
              <ContentTypeCard
                icon={<UploadCloud className="h-4 w-4" />}
                iconBg="bg-amber-600"
                title="Upload a SCORM package"
                description="Import a SCORM package as your starting content"
                selected={selectedCourseMethod === "scorm"}
                onClick={() => setSelectedCourseMethod("scorm")}
              />
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={handleCourseMethodContinue} disabled={!selectedCourseMethod}>
              Continue
            </Button>
          </div>
        </div>
      </Modal>

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

      <Modal open={comingSoonType !== null} onClose={() => setComingSoonType(null)} title="Coming soon">
        <p className="text-sm text-secondary">
          {comingSoonType && CONTENT_TYPE_LABEL[comingSoonType]} isn&apos;t available yet. For now, use &ldquo;Course&rdquo; to get started.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setComingSoonType(null)}>
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
