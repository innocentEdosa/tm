"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Eye, Image as ImageIcon, Upload, X } from "lucide-react";
import { Badge, Button, Input, Modal, RepeatableFieldList } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { SubdomainProvider, useSubdomain } from "@/lib/subdomain-context";
import { CourseEditorApiProvider, useCourseEditorApi } from "@/lib/course-editor-context";
import { tenantCourseEditorApi } from "@/lib/course-editor-adapter";
import type { CourseLearnerProgressRow, CourseReview, CourseStatus, DeliveryMode, DurationUnit, TenantFile } from "@/lib/course-api-types";
import { IMAGE_CONTENT_TYPES } from "@/lib/file-format";
import CategoryCombobox from "@/app/(dashboard-shell)/learning/courses/category-combobox";
import SettingsTab from "@/app/(dashboard-shell)/learning/courses/[courseId]/settings-tab";
import ExistingFilePicker from "@/app/(dashboard-shell)/learning/courses/[courseId]/existing-file-picker";

// Tiptap/ProseMirror is one of the heaviest deps in @tm/ui — code-split it, same rationale as
// course-details-panel.tsx's own dynamic import.
const RichTextEditor = dynamic(() => import("@tm/ui").then((mod) => mod.RichTextEditor), {
  ssr: false,
  loading: () => <div className="h-[160px] animate-pulse rounded-lg border border-border bg-slate-50" />,
});

// Drag-and-drop (@dnd-kit/*) is only needed once the Curriculum step is reached — code-split it out
// of this page's initial bundle, same rationale as course-editor-client.tsx's own dynamic import of
// the exact same component.
const CurriculumShell = dynamic(() => import("@/app/(dashboard-shell)/learning/courses/[courseId]/curriculum-shell"), {
  ssr: false,
  loading: () => <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-300 border-t-transparent" />,
});

// Same code-splitting rationale — only needed once the Performance step actually renders, and that
// step itself only ever appears once there's real learner/review activity to show (see
// `hasPerformanceData` below), so most courses being created never pay for this bundle at all.
const PerformanceShell = dynamic(() => import("@/app/(dashboard-shell)/learning/courses/[courseId]/performance-shell"), {
  ssr: false,
  loading: () => <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-300 border-t-transparent" />,
});

const DELIVERY_MODE_LABEL: Record<DeliveryMode, string> = {
  in_person: "In person",
  virtual: "Virtual",
  self_paced: "Self-paced",
  blended: "Blended",
};

const DURATION_UNIT_LABEL: Record<DurationUnit, string> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

const STATUS_BADGE_VARIANT: Record<CourseStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
};
const STATUS_LABEL: Record<CourseStatus, string> = { active: "Published", draft: "Draft", archived: "Archived" };

// Purely a starting suggestion for a blank course — neither list is required, and every row
// (including these initial ones) can be removed. Mirrors course-objectives-panel.tsx's own seeding.
const INITIAL_OBJECTIVE_SLOTS = 3;
function seedObjectives(values: string[]): string[] {
  return values.length >= INITIAL_OBJECTIVE_SLOTS ? values : [...values, ...Array(INITIAL_OBJECTIVE_SLOTS - values.length).fill("")];
}
function seedRequirements(values: string[]): string[] {
  return values.length > 0 ? values : [""];
}

/** Mirrors the sections a course already goes through in the existing tabbed editor
 * (`course-editor-client.tsx`'s Information/Curriculum/Settings/Performance top tabs, with
 * Information's own "Course Details"/"Course Objectives" sub-tabs split out) — every step here
 * reuses that same editor's own components (`CurriculumShell`, `SettingsTab`, `PerformanceShell`)
 * once the draft course exists, so this wizard is a genuinely complete creation flow, not a preview
 * of one. "Performance" is appended conditionally (see `hasPerformanceData` in the component below) —
 * a brand-new course has no learners or reviews yet, so showing that step from the start would just
 * be an empty shell; it appears once there's something real to show. */
const BASE_STEPS: { id: string; label: string }[] = [
  { id: "overview", label: "Course Overview" },
  { id: "objectives", label: "Course Objectives" },
  { id: "curriculum", label: "Curriculum" },
  { id: "settings", label: "Settings" },
];

type AutoSaveStatus = "idle" | "saving" | "saved";

// Deliberately much longer than the 600ms lesson-form autosave (use-autosave-content-item.tsx) —
// this wizard has no per-field submit button and no urgency to persist a half-typed title/description
// instantly, so a longer pause avoids a PATCH on nearly every keystroke pause while still saving well
// before the admin would ever lose meaningful work (Continue also flushes this immediately, so
// clicking through the wizard is never blocked by it).
const AUTOSAVE_DELAY_MS = 5_000;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-5">
      <p className="mb-4 text-sm font-semibold text-primary">{title}</p>
      {children}
    </div>
  );
}

/**
 * The "Media" panel — the course image uploads immediately on selection (creating the draft course
 * first if one doesn't exist yet), same "no separate save step" behavior as the old tabbed editor's
 * `course-image-field.tsx`, rather than staging a file locally until some later explicit save.
 * "Or choose from existing files" mirrors `course-image-field.tsx`'s own trigger + `ExistingFilePicker`
 * drawer exactly — `onReuse` (the parent's `handleReuseImage`) handles the same lazy-draft-creation
 * `ensureCourseId()` the plain upload path already needs, so this works identically whether or not a
 * draft course exists yet.
 */
function MediaPanel({
  imageUrl,
  uploading,
  error,
  onUpload,
  onReuse,
  supportsFileManager,
}: {
  imageUrl: string | null;
  uploading: boolean;
  error: string | null;
  onUpload: (file: File | undefined) => void;
  onReuse: (file: TenantFile) => Promise<void>;
  supportsFileManager: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reusingId, setReusingId] = useState<string | null>(null);
  const [reuseError, setReuseError] = useState<string | null>(null);

  async function handleReuse(file: TenantFile) {
    setReuseError(null);
    setReusingId(file.id);
    try {
      await onReuse(file);
      setDrawerOpen(false);
    } catch (err) {
      setReuseError((err as Error).message);
    } finally {
      setReusingId(null);
    }
  }

  return (
    <Panel title="Media">
      {error && <p className="banner-error mb-2">{error}</p>}
      <input
        id="create-course-media-input"
        type="file"
        accept=".jpeg,.jpg,.png,.gif,.webp"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          onUpload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {imageUrl ? (
        <div className="flex items-stretch gap-3">
          <div className="relative h-24 w-36 shrink-0 overflow-hidden rounded-lg border border-border">
            <Image src={imageUrl} alt="" fill sizes="144px" className="object-cover" />
          </div>
          <label
            htmlFor="create-course-media-input"
            className={`flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-center ${
              uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-100"
            }`}
          >
            <span className="text-sm text-secondary">
              <span className="font-semibold underline">{uploading ? "Uploading…" : "Change"}</span>
            </span>
          </label>
        </div>
      ) : (
        <label
          htmlFor="create-course-media-input"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!uploading) onUpload(e.dataTransfer.files?.[0]);
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-slate-50 px-6 py-10 text-center ${
            uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-100"
          }`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-secondary">
            <Upload className="h-4 w-4" />
          </span>
          <p className="text-sm text-secondary">
            <span className="font-semibold underline">{uploading ? "Uploading…" : "Click to upload"}</span> {!uploading && "or drag and drop"}
          </p>
          <p className="text-xs text-muted">Recommended .jpeg, .jpg, .png, or .webp</p>
        </label>
      )}

      {supportsFileManager && (
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
    </Panel>
  );
}

function CreateCourseInner({ existingCourseId, currentUserEmail }: { existingCourseId?: string; currentUserEmail: string }) {
  const router = useRouter();
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const api = useCourseEditorApi();

  const [currentStep, setCurrentStep] = useState(0);
  // Set immediately when editing an existing course; otherwise set the first time any autosave (or
  // the image upload) actually creates the draft — Curriculum and Settings (both reused from the
  // existing tabbed editor) need a real id to fetch/mutate against.
  const [courseId, setCourseId] = useState<string | null>(existingCourseId ?? null);
  // Debounced autosave callbacks close over whatever `courseId` was at the time they were scheduled,
  // which lags a render behind a just-created draft — this ref is always current, so a save that
  // creates the draft and a later one that updates it never race on a stale `null`.
  const courseIdRef = useRef<string | null>(existingCourseId ?? null);
  function setCourseIdEverywhere(id: string) {
    courseIdRef.current = id;
    setCourseId(id);
  }

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("self_paced");
  const [durationValue, setDurationValue] = useState("1");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("hours");

  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [localImagePreview, setLocalImagePreview] = useState<string | null>(null);

  // "Course Objectives" step — Learning Objectives and Requirements/resources, same two lists as
  // course-objectives-panel.tsx's own "Course Objectives" tab (the only "resources" concept that
  // exists for a course today — lesson-level file/link attachments are a separate, per-lesson thing,
  // only reachable once a lesson exists in the Curriculum step).
  const [objectives, setObjectives] = useState<string[]>(Array(INITIAL_OBJECTIVE_SLOTS).fill(""));
  const [requirements, setRequirements] = useState<string[]>([""]);

  const [submitting, setSubmitting] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const overviewSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectivesSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The single source of truth for the header (title, status) once a real course exists — also
  // seeds every field below when opening this wizard on an *existing* course (editing), so "on edit"
  // lands on the same fullscreen flow pre-filled with real data instead of a blank one.
  const courseQuery = useQuery({
    queryKey: ["course", courseId, api.cacheScope],
    queryFn: () => api.fetchCourse(courseId!),
    enabled: !!courseId,
  });
  const course = courseQuery.data;

  // Drives whether the "Performance" step exists at all — shares its query key/cache with
  // `learners-tab.tsx`/`reviews-tab.tsx` (the tabs `PerformanceShell` itself renders), so opening
  // this wizard "on edit" for a course that already has activity doesn't refetch what those tabs will
  // fetch again a moment later. A brand-new course has neither yet, so the step simply isn't there
  // until real learner or review activity exists.
  const progressQuery = useQuery({
    queryKey: ["course-learner-progress", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseLearnerProgressRow[] }>(`/courses/${courseId}/progress/learners`, { subdomain });
      return data;
    },
    enabled: !!courseId,
  });
  const reviewsQuery = useQuery({
    queryKey: ["course-reviews", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseReview[] }>(`/courses/${courseId}/reviews`, { subdomain });
      return data;
    },
    enabled: !!courseId,
  });
  const hasPerformanceData = (progressQuery.data?.length ?? 0) > 0 || (reviewsQuery.data?.length ?? 0) > 0;
  const steps = hasPerformanceData ? [...BASE_STEPS, { id: "performance", label: "Performance" }] : BASE_STEPS;
  const lastStep = steps.length - 1;

  useEffect(() => {
    if (!course) return;
    setTitle(course.title);
    setDescription(course.description ?? "");
    setCategoryName(course.category?.name ?? "");
    setSubcategory(course.subcategory ?? "");
    setDeliveryMode(course.deliveryMode);
    setDurationValue(String(course.duration.value));
    setDurationUnit(course.duration.unit);
    setObjectives(seedObjectives(course.learningObjectives));
    setRequirements(seedRequirements(course.requirements));
    // Only re-sync when the course id itself first resolves — not after every later refetch, which
    // would otherwise clobber whatever the admin is mid-typing. Matches course-details-panel.tsx's
    // own rationale for the identical guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  /**
   * Debounced create-then-update autosave for "Course Overview" — mirrors
   * `content-item-forms/use-autosave-content-item.tsx`'s own create-then-update pattern (create the
   * draft on the first save that satisfies validation, PATCH from then on), just with a much longer
   * `AUTOSAVE_DELAY_MS` pause since there's no per-field submit button here. Silently skips while
   * title/category aren't filled in yet, exactly like that hook does for its own required fields — no
   * validation error shown on every keystroke.
   */
  function scheduleOverviewSave(next: {
    title: string;
    description: string;
    categoryName: string;
    subcategory: string;
    deliveryMode: DeliveryMode;
    durationValue: string;
    durationUnit: DurationUnit;
  }) {
    if (!next.title.trim() || !next.categoryName.trim()) return;
    if (overviewSaveTimeoutRef.current) clearTimeout(overviewSaveTimeoutRef.current);
    setAutosaveStatus("saving");
    overviewSaveTimeoutRef.current = setTimeout(async () => {
      try {
        let id = courseIdRef.current;
        if (!id) {
          const created = await api.createDraftCourse({ title: next.title.trim() });
          id = created.id;
          setCourseIdEverywhere(id);
        }
        await api.updateCourseDetails(id, {
          title: next.title.trim(),
          description: next.description,
          category: next.categoryName,
          ...(api.supportsSubcategory ? { subcategory: next.subcategory } : {}),
          deliveryMode: next.deliveryMode,
          duration: { value: Number(next.durationValue) || 0, unit: next.durationUnit },
        });
        queryClient.invalidateQueries({ queryKey: ["course", id, api.cacheScope] });
        setAutosaveStatus("saved");
      } catch (err) {
        setError((err as Error).message);
        setAutosaveStatus("idle");
      }
    }, AUTOSAVE_DELAY_MS);
  }

  /** Same debounced pattern for "Course Objectives" — only meaningful once a course already exists
   * (created by the Overview step's own autosave above, or already real when editing), so this
   * silently no-ops until then rather than trying to create a title-less draft from here too. */
  function scheduleObjectivesSave(nextObjectives: string[], nextRequirements: string[]) {
    if (!courseIdRef.current) return;
    if (objectivesSaveTimeoutRef.current) clearTimeout(objectivesSaveTimeoutRef.current);
    setAutosaveStatus("saving");
    objectivesSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await api.updateObjectives(courseIdRef.current!, { learningObjectives: nextObjectives, requirements: nextRequirements });
        setAutosaveStatus("saved");
      } catch (err) {
        setError((err as Error).message);
        setAutosaveStatus("idle");
      }
    }, AUTOSAVE_DELAY_MS);
  }

  // Shared by both the plain-upload and "choose from existing files" paths below — either one may
  // be the very first thing an admin does on a brand-new course, before any draft exists yet.
  async function ensureCourseId(): Promise<string> {
    let id = courseIdRef.current;
    if (!id) {
      const created = await api.createDraftCourse({ title: title.trim() || "Untitled course" });
      id = created.id;
      setCourseIdEverywhere(id);
    }
    return id;
  }

  async function handleImageFile(file: File | undefined) {
    if (!file || !api.uploadCourseImage) return;
    setImageError(null);
    setLocalImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const id = await ensureCourseId();
      await api.uploadCourseImage(id, file);
      await queryClient.invalidateQueries({ queryKey: ["course", id, api.cacheScope] });
    } catch (err) {
      setImageError((err as Error).message);
    } finally {
      setImageUploading(false);
    }
  }

  async function handleReuseImage(file: TenantFile) {
    if (!api.reuseCourseImage) return;
    const id = await ensureCourseId();
    await api.reuseCourseImage(id, file.id);
    setLocalImagePreview(null);
    await queryClient.invalidateQueries({ queryKey: ["course", id, api.cacheScope] });
  }

  const canContinueOverview = title.trim().length > 0 && categoryName.trim().length > 0;
  const canContinue = !submitting && (currentStep === 0 ? canContinueOverview : true);
  const canPublish = !!courseId && !submitting;

  // Every step already autosaves itself as the admin edits it (Overview/Objectives via the
  // schedule*Save functions above; Curriculum/Settings via their own reused components' own
  // mutations) — Continue mainly just advances. It still flushes any pending debounce and awaits it
  // directly, so clicking Continue right after typing can't lose the last few keystrokes to the
  // `AUTOSAVE_DELAY_MS` wait, and so the draft is guaranteed to exist before Curriculum/Settings
  // unlock.
  async function handleContinue() {
    if (!canContinue) return;
    setSubmitting(true);
    setError(null);
    try {
      if (currentStep === 0) {
        if (overviewSaveTimeoutRef.current) clearTimeout(overviewSaveTimeoutRef.current);
        let id = courseIdRef.current;
        if (!id) {
          const created = await api.createDraftCourse({ title: title.trim() });
          id = created.id;
          setCourseIdEverywhere(id);
        }
        await api.updateCourseDetails(id, {
          title: title.trim(),
          description,
          category: categoryName,
          ...(api.supportsSubcategory ? { subcategory } : {}),
          deliveryMode,
          duration: { value: Number(durationValue) || 0, unit: durationUnit },
        });
        await queryClient.invalidateQueries({ queryKey: ["course", id, api.cacheScope] });
        setAutosaveStatus("saved");
      } else if (currentStep === 1 && courseIdRef.current) {
        if (objectivesSaveTimeoutRef.current) clearTimeout(objectivesSaveTimeoutRef.current);
        await api.updateObjectives(courseIdRef.current, { learningObjectives: objectives, requirements });
        setAutosaveStatus("saved");
      }
      setCurrentStep((step) => step + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // The last step: publishes the course (draft → active) and returns to the course list — publishing
  // is the natural end of this flow, so there's no reason to land back inside an editor (old or new)
  // afterward.
  async function handlePublish() {
    if (!courseId) return;
    setSubmitting(true);
    setError(null);
    try {
      await tenantFetch(`/courses/${courseId}`, { method: "PATCH", subdomain, body: { status: "active" } });
      router.push("/learning/courses");
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-white">
        <div className="flex items-center justify-between gap-4 px-8 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Close"
              onClick={() => router.push("/learning/courses")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
            <h1 className="min-w-0 text-lg font-bold break-words text-primary">{course?.title || "Create Course"}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {course && <Badge variant={STATUS_BADGE_VARIANT[course.status]}>{STATUS_LABEL[course.status]}</Badge>}
            {course && (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-secondary hover:bg-slate-100 hover:text-primary"
              >
                <Eye className="h-4 w-4" />
                Preview
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2 px-8">
          {steps.map((step, index) => {
            // Curriculum/Settings reuse the real editor components, which need a courseId to fetch
            // against — those two stay disabled until "Course Overview" has created the draft.
            const locked = index >= 2 && !courseId;
            return (
              <button
                key={step.id}
                type="button"
                aria-label={`Go to ${step.label}`}
                aria-current={currentStep === index}
                disabled={locked}
                onClick={() => setCurrentStep(index)}
                title={locked ? "Finish Course Overview first" : step.label}
                className={`flex flex-1 flex-col items-start gap-1.5 transition-opacity ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-80"}`}
              >
                <span className={`text-xs font-medium ${currentStep === index ? "text-primary" : "text-muted"}`}>{step.label}</span>
                <span className={`h-1 w-full rounded-full ${index <= currentStep ? "bg-cta" : "bg-slate-200"}`} />
              </button>
            );
          })}
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-8 pt-8 pb-20">
        {error && <p className="banner-error mb-6">{error}</p>}

        {currentStep === 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
            <div className="flex flex-col gap-6">
              {api.supportsCourseImage && (
                <MediaPanel
                  imageUrl={localImagePreview ?? course?.courseImageUrl ?? null}
                  uploading={imageUploading}
                  error={imageError}
                  onUpload={handleImageFile}
                  onReuse={handleReuseImage}
                  supportsFileManager={api.supportsFileManager}
                />
              )}
            </div>

            <div className="flex flex-col gap-6">
              <div>
                <label className="field-label" htmlFor="create-course-title">
                  Title <span className="text-red-600">*</span>
                </label>
                <Input
                  id="create-course-title"
                  placeholder="Write a title here"
                  value={title}
                  onChange={(e) => {
                    const value = e.target.value;
                    setTitle(value);
                    scheduleOverviewSave({ title: value, description, categoryName, subcategory, deliveryMode, durationValue, durationUnit });
                  }}
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor="create-course-description">
                  Full description
                </label>
                <RichTextEditor
                  key={courseId ?? "new"}
                  id="create-course-description"
                  defaultValue={description}
                  onChange={(html) => {
                    setDescription(html);
                    scheduleOverviewSave({ title, description: html, categoryName, subcategory, deliveryMode, durationValue, durationUnit });
                  }}
                  placeholder="Write description here"
                />
              </div>

              <Panel title="Option">
                <div className="flex flex-col gap-4">
                  {api.supportsCategoryList ? (
                    <CategoryCombobox
                      value={categoryName}
                      onChange={(value) => {
                        setCategoryName(value);
                        scheduleOverviewSave({ title, description, categoryName: value, subcategory, deliveryMode, durationValue, durationUnit });
                      }}
                      id="create-course-category"
                    />
                  ) : (
                    <div>
                      <label className="field-label" htmlFor="create-course-category">
                        Category <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="create-course-category"
                        className="field-input"
                        placeholder="e.g. Compliance, Leadership, Technical"
                        value={categoryName}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCategoryName(value);
                          scheduleOverviewSave({ title, description, categoryName: value, subcategory, deliveryMode, durationValue, durationUnit });
                        }}
                        required
                      />
                    </div>
                  )}

                  {api.supportsSubcategory && (
                    <div>
                      <label className="field-label" htmlFor="create-course-subcategory">
                        Subcategory
                      </label>
                      <input
                        id="create-course-subcategory"
                        className="field-input"
                        placeholder="e.g. Workplace Safety"
                        value={subcategory}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSubcategory(value);
                          scheduleOverviewSave({ title, description, categoryName, subcategory: value, deliveryMode, durationValue, durationUnit });
                        }}
                      />
                    </div>
                  )}

                  <div>
                    <label className="field-label" htmlFor="create-course-delivery-mode">
                      Delivery mode
                    </label>
                    <select
                      id="create-course-delivery-mode"
                      className="field-input"
                      value={deliveryMode}
                      onChange={(e) => {
                        const value = e.target.value as DeliveryMode;
                        setDeliveryMode(value);
                        scheduleOverviewSave({ title, description, categoryName, subcategory, deliveryMode: value, durationValue, durationUnit });
                      }}
                    >
                      {Object.entries(DELIVERY_MODE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="field-label" htmlFor="create-course-duration">
                        Estimate duration
                      </label>
                      <Input
                        id="create-course-duration"
                        type="number"
                        min={0}
                        step="any"
                        value={durationValue}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDurationValue(value);
                          scheduleOverviewSave({ title, description, categoryName, subcategory, deliveryMode, durationValue: value, durationUnit });
                        }}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="create-course-duration-unit">
                        Unit
                      </label>
                      <select
                        id="create-course-duration-unit"
                        className="field-input"
                        value={durationUnit}
                        onChange={(e) => {
                          const value = e.target.value as DurationUnit;
                          setDurationUnit(value);
                          scheduleOverviewSave({ title, description, categoryName, subcategory, deliveryMode, durationValue, durationUnit: value });
                        }}
                      >
                        {Object.entries(DURATION_UNIT_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="mx-auto flex max-w-3xl flex-col gap-8">
            <Panel title="Learning Objectives">
              <p className="mb-4 text-sm text-muted">
                Add the learning objectives or outcomes that learners can anticipate achieving upon finishing the course.
              </p>
              <RepeatableFieldList
                items={objectives}
                onChange={(next) => {
                  setObjectives(next);
                  scheduleObjectivesSave(next, requirements);
                }}
                itemPlaceholder={(i) => `Objective ${i + 1}`}
                addLabel="Add Objective"
              />
            </Panel>

            <Panel title="Requirements & Resources">
              <p className="mb-4 text-sm text-muted">
                List the necessary prerequisites, tools, or resources learners need before taking your course.
              </p>
              <RepeatableFieldList
                items={requirements}
                onChange={(next) => {
                  setRequirements(next);
                  scheduleObjectivesSave(objectives, next);
                }}
                itemPlaceholder={(i) => `Requirement/resource ${i + 1}`}
                addLabel="Add Requirement"
              />
            </Panel>
          </div>
        )}

        {currentStep === 2 && courseId && <CurriculumShell courseId={courseId} readOnly={false} />}

        {currentStep === 3 && courseId && <SettingsTab courseId={courseId} readOnly={false} />}

        {currentStep === 4 && hasPerformanceData && courseId && (
          <PerformanceShell courseId={courseId} courseName={course?.title ?? title} readOnly={false} currentUserEmail={currentUserEmail} />
        )}
      </main>

      {/* Persistent across every step — a narrow, centered floating card (not full width, and well
          short of the content column's own max-w-6xl). `sticky` (not `fixed`) plus `main`'s own
          `flex-1` keeps it pinned to the viewport bottom on short steps while still scrolling
          normally with tall ones (e.g. Curriculum). */}
      <div className="sticky bottom-3 z-20 mx-auto w-full max-w-xl px-8">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-white px-5 py-3 shadow-card-lg">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {autosaveStatus === "saving" ? (
              <>
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                <span>Saving…</span>
              </>
            ) : (
              courseId && <span>Saved to draft</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={() => setCurrentStep((step) => step - 1)}
                disabled={submitting}
                className="flex cursor-pointer items-center gap-1 px-2 text-sm font-medium text-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            )}
            {currentStep === lastStep ? (
              <Button size="sm" onClick={handlePublish} disabled={!canPublish} isLoading={submitting}>
                Publish Course
              </Button>
            ) : (
              <Button size="sm" onClick={handleContinue} disabled={!canContinue} isLoading={submitting}>
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview">
        <p className="text-sm text-secondary">Course preview isn&apos;t available yet.</p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Fullscreen course editor — used both to create a brand-new course (`courseId` omitted) and, "on
 * edit", to reopen an existing one (`courseId` passed by `[courseId]/edit/page.tsx`) in the exact
 * same step-based flow instead of the old tabbed editor. The old tabbed editor
 * (`(dashboard-shell)/learning/courses/[courseId]/*`) is intentionally left in place, unchanged.
 * `currentUserEmail` is only ever consumed once the conditional "Performance" step actually renders
 * (`PerformanceShell`'s own review-response attribution) — always passed through regardless, same as
 * `course-editor-client.tsx`'s own unconditional prop.
 */
export default function CreateCourseClient({
  subdomain,
  courseId,
  currentUserEmail,
}: {
  subdomain: string;
  courseId?: string;
  currentUserEmail: string;
}) {
  const api = tenantCourseEditorApi(subdomain);
  return (
    <SubdomainProvider subdomain={subdomain}>
      <CourseEditorApiProvider api={api}>
        <CreateCourseInner existingCourseId={courseId} currentUserEmail={currentUserEmail} />
      </CourseEditorApiProvider>
    </SubdomainProvider>
  );
}
