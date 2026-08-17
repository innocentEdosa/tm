"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { FileText, FileUp, Layers, ListChecks, Plus, Route, Sparkles, UploadCloud, X } from "lucide-react";
import { Button, Input, Modal } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import { uploadFileToPresignedUrl } from "@/lib/course-editor-adapter";
import { useOptionalSubdomain } from "@/lib/subdomain-context";
import { generateCourseFromAi } from "@/lib/ai-course-generation";

// Tiptap/ProseMirror is one of the heaviest deps in @tm/ui — code-split it, same rationale as
// course-details-panel.tsx's own dynamic import.
const RichTextEditor = dynamic(() => import("@tm/ui").then((mod) => mod.RichTextEditor), {
  ssr: false,
  loading: () => <div className="h-[160px] animate-pulse rounded-lg border border-border bg-slate-50" />,
});

type ContentType = "course" | "quiz_assignment" | "learning_path";
type CourseMethod = "ai" | "manual" | "scorm";

// The "AI-Assisted Generation" supporting-document upload — this is a client-side-only accept/size
// guard for immediate feedback; the real allowlist check (`attachment-allowlist.ts`'s
// `ai_course_generation_document` entry) is enforced again server-side, same "trust nothing from the
// client" posture as every other upload in this app.
const AI_DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp";
const AI_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The rich-text prompt editor's `onChange` gives back HTML (e.g. a truly empty editor is still
 * `"<p></p>"`, not `""`) — `.trim()` alone can't tell "genuinely blank" from "just markup," so the
 * Generate button's enabled state and this modal's own validation both need an actual visible-text
 * check instead. */
function hasVisibleText(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim().length > 0;
}

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
 * (e.g. `content-item-type-picker.tsx`'s own AI option). "Generate with AI" opens straight into the
 * "AI-Assisted Generation" modal below — a rich-text prompt plus an optional supporting-document
 * upload, no separate method-selection step — but nothing behind either field is wired up yet, so
 * "Generate course" has nothing to actually call.
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
  // Optional, not `useSubdomain()` — this component is also rendered on the platform
  // course-marketplace page, which has no `SubdomainProvider` at all (no tenant subdomain concept
  // there). Only ever actually read when `api.supportsAiGeneration` is true, which is tenant-only.
  const subdomain = useOptionalSubdomain();
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ContentType | null>(null);
  const [courseMethodModalOpen, setCourseMethodModalOpen] = useState(false);
  const [selectedCourseMethod, setSelectedCourseMethod] = useState<CourseMethod | null>(null);
  const [comingSoonType, setComingSoonType] = useState<ContentType | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  // Deliberately never reset just by closing (via the X, backdrop click, or navigating back to an
  // earlier step) — only a successful generation clears these. An admin who spent a minute writing a
  // prompt and then closes the modal by mistake must find it exactly as they left it when they
  // reopen "Generate with AI". `aiGenerating`/`aiGenerateError` live at this same level (not inside
  // the modal's own JSX) for the same reason: closing the modal mid-generation must not lose track of
  // an in-flight request — reopening shows "Generating…" still in progress rather than a blank form
  // that looks like nothing is happening (this feature's own "user closes the modal while generation
  // is running" requirement).
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiDocumentFile, setAiDocumentFile] = useState<File | null>(null);
  const [aiDocumentError, setAiDocumentError] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerateError, setAiGenerateError] = useState<string | null>(null);
  const [scormModalOpen, setScormModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Guards the async generation handler's own `setState` calls against firing after this component
  // has unmounted (e.g. the admin navigates fully away from the courses list mid-generation) — the
  // request itself is intentionally never aborted (this feature's own choice: a generation already
  // in flight finishes and still creates the draft course even if its own UI is gone by then).
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  function handleAiDocumentSelected(file: File | undefined) {
    if (!file) return;
    if (file.size > AI_DOCUMENT_MAX_BYTES) {
      setAiDocumentError("That file is too large — PDF, DOCX, or images up to 10MB.");
      return;
    }
    setAiDocumentError(null);
    setAiDocumentFile(file);
  }

  async function handleGenerateCourse() {
    if (aiGenerating) return; // guards against a duplicate submission from a double click
    if (!hasVisibleText(aiPrompt) && !aiDocumentFile) {
      setAiGenerateError("Describe the course or upload a document before generating.");
      return;
    }
    if (!subdomain) return; // unreachable — the entry point is hidden whenever supportsAiGeneration is false

    setAiGenerateError(null);
    setAiGenerating(true);
    try {
      const { courseId } = await generateCourseFromAi({ subdomain, prompt: aiPrompt, documentFile: aiDocumentFile });
      if (!isMountedRef.current) return;
      setAiPrompt("");
      setAiDocumentFile(null);
      setAiModalOpen(false);
      router.push(`${editorBasePath}/${courseId}/edit`);
    } catch (err) {
      if (!isMountedRef.current) return;
      setAiGenerateError((err as Error).message);
    } finally {
      if (isMountedRef.current) setAiGenerating(false);
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

      <Modal
        open={courseMethodModalOpen}
        onClose={() => setCourseMethodModalOpen(false)}
        onBack={() => {
          setCourseMethodModalOpen(false);
          setTypeModalOpen(true);
        }}
        title="Create a course"
        size="lg"
      >
        <div className="flex min-h-[420px] flex-col">
          <div className="grid flex-1 grid-cols-1 content-start gap-4 sm:grid-cols-2">
            {api.supportsAiGeneration && (
              <ContentTypeCard
                icon={<Sparkles className="h-4 w-4" />}
                iconBg="bg-fuchsia-600"
                title="Generate with AI"
                description="Create a course draft with the power of AI"
                selected={selectedCourseMethod === "ai"}
                onClick={() => setSelectedCourseMethod("ai")}
              />
            )}
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

      <Modal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onBack={() => {
          setAiModalOpen(false);
          setCourseMethodModalOpen(true);
        }}
        title="AI-Assisted Generation"
        titleIcon={
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <Sparkles className="h-4 w-4" />
          </span>
        }
        size="lg"
      >
        <div className="flex min-h-[420px] flex-col">
          <div className="flex-1 flex flex-col gap-4">
            <p className="text-sm text-secondary">
              Upload a syllabus document or provide a detailed description of the course you want, and our AI will draft the course
              structure, modules, and quizzes for you to review.
            </p>

            {aiGenerateError && <p className="banner-error">{aiGenerateError}</p>}

            <div>
              <label className="field-label" htmlFor="ai-course-prompt">
                Describe your course
              </label>
              <RichTextEditor
                id="ai-course-prompt"
                defaultValue={aiPrompt}
                onChange={setAiPrompt}
                placeholder="Describe the course goals, audience, and topics you want covered…"
                readOnly={aiGenerating}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="ai-course-document">
                Or upload document containing description
              </label>
              <input
                id="ai-course-document"
                type="file"
                accept={AI_DOCUMENT_ACCEPT}
                className="hidden"
                disabled={aiGenerating}
                onChange={(e) => {
                  handleAiDocumentSelected(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {aiDocumentError && <p className="field-error mb-1.5">{aiDocumentError}</p>}
              {aiDocumentFile ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileUp className="h-4 w-4 shrink-0 text-secondary" />
                    <span className="truncate text-sm text-primary">{aiDocumentFile.name}</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove document"
                    disabled={aiGenerating}
                    onClick={() => {
                      setAiDocumentFile(null);
                      setAiDocumentError(null);
                    }}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-secondary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="ai-course-document"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!aiGenerating) handleAiDocumentSelected(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-left ${
                    aiGenerating ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-100"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-secondary">
                    <FileUp className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-secondary">
                      <span className="font-semibold underline">Click to upload</span> or drag and drop
                    </span>
                    <span className="block text-xs text-muted">PDF, DOCX, or images up to 10MB</span>
                  </span>
                </label>
              )}
            </div>

            {aiGenerating ? (
              <div className="banner-info flex items-center gap-3">
                <span className="btn-spinner shrink-0 text-sky-600" aria-hidden="true" />
                <p>
                  <span className="font-semibold">Generating your course</span> — this can take a little while. Feel
                  free to close this; we&apos;ll take you to it once it&apos;s ready.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted">
                We&apos;ll draft a starting structure for you to review, edit, and publish — nothing goes live until you do.
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <Button onClick={handleGenerateCourse} isLoading={aiGenerating} disabled={aiGenerating || (!hasVisibleText(aiPrompt) && !aiDocumentFile)}>
              Generate course
            </Button>
          </div>
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
        <ScormQuickCreateModal
          open={scormModalOpen}
          onClose={() => setScormModalOpen(false)}
          onBack={() => {
            setScormModalOpen(false);
            setCourseMethodModalOpen(true);
          }}
          editorBasePath={editorBasePath}
        />
      )}
    </>
  );
}

function ScormQuickCreateModal({
  open,
  onClose,
  onBack,
  editorBasePath,
}: {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  editorBasePath: string;
}) {
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
      onBack={() => {
        if (uploading) return;
        reset();
        onBack();
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
