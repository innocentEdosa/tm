"use client";

// Course Marketplace spec (029), User Story 4/5 — tenant course detail + select/request action. Free
// courses clone immediately; paid courses create a pending request (contracts/course-marketplace-api.md).
// Full-screen layout (spec 032 follow-up) — deliberately outside `(dashboard-shell)` (see this
// route's page.tsx), styled as a dedicated course-preview landing page rather than app-shell content.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button } from "@tm/ui";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Layers,
  Link2,
  ListChecks,
  PlayCircle,
  Radio,
  X,
} from "lucide-react";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";

const API_BASE = "/tenant-api/tenant";

interface ContentItem {
  id: string;
  type: string;
  title: string;
}

interface CourseModule {
  id: string;
  title: string;
  contentItems: ContentItem[];
}

interface PlatformCourseDetail {
  id: string;
  title: string;
  description: string | null;
  categoryName: string;
  deliveryMode: string;
  duration: { value: number; unit: string };
  cost: number | null;
  alreadySelected: boolean;
  selectionStatus: string | null;
  learningObjectives: string[];
  requirements: string[];
  courseImageUrl: string | null;
  modules: CourseModule[];
}

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; data: PlatformCourseDetail };

const CONTENT_ITEM_ICON: Record<string, typeof PlayCircle> = {
  video: PlayCircle,
  article: FileText,
  live_class: Radio,
  test: ListChecks,
  assignment: ListChecks,
  external_import: Link2,
};

function formatDeliveryMode(mode: string): string {
  return mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CourseMarketplaceDetailClient({
  subdomain,
  platformCourseId,
}: {
  subdomain: string;
  platformCourseId: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selectOutcome, setSelectOutcome] = useState<{ outcome: string; courseId?: string } | null>(null);
  const [expandedModuleIds, setExpandedModuleIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    fetch(`${API_BASE}/course-marketplace/${platformCourseId}?${new URLSearchParams({ subdomain })}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (res.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as { data: PlatformCourseDetail };
        setState({ status: "ready", data: json.data });
        // First section open by default, like Udemy's own course-content accordion.
        setExpandedModuleIds(json.data.modules[0] ? new Set([json.data.modules[0].id]) : new Set());
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [subdomain, platformCourseId, reloadToken]);

  async function select() {
    setSelecting(true);
    setSelectError(null);
    try {
      const res = await fetch(
        `${API_BASE}/course-marketplace/${platformCourseId}/select?${new URLSearchParams({ subdomain })}`,
        { method: "POST", credentials: "include" },
      );
      const json = (await res.json()) as { success: boolean; message?: string; data?: { outcome: string; courseId?: string } };
      if (!res.ok || !json.success) {
        setSelectError(json.message ?? "Couldn't complete this action. Try again.");
        return;
      }
      setSelectOutcome(json.data ?? null);
      setReloadToken((t) => t + 1);
    } catch {
      setSelectError("Couldn't reach the server. Try again.");
    } finally {
      setSelecting(false);
    }
  }

  function toggleModule(moduleId: string) {
    setExpandedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  if (state.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <p className="text-sm text-slate-600">Loading…</p>
      </div>
    );
  }
  if (state.status === "forbidden" || state.status === "not-found" || state.status === "error") {
    const message =
      state.status === "forbidden"
        ? "You don't have access to the course marketplace."
        : state.status === "not-found"
          ? "This course isn't available."
          : "Couldn't load this course.";
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <div role="alert" className="banner-error max-w-md">
          {message}
        </div>
        <Link href="/learning/marketplace" className="text-sm text-cta hover:underline">
          ← Back to Course Marketplace
        </Link>
      </div>
    );
  }

  const course = state.data;
  const isPaid = !!course.cost;
  const isPending = course.selectionStatus === "requested";
  const isFulfilled = course.selectionStatus === "fulfilled" || course.alreadySelected;
  const moduleCount = course.modules.length;
  const lessonCount = course.modules.reduce((sum, m) => sum + m.contentItems.length, 0);

  return (
    <div className="min-h-screen overflow-y-auto bg-surface">
      {/* Hero — dark, full-width, mirrors the app's own sidebar tone (--color-primary) rather than
          introducing a new brand color, per the established design system (Constitution Principle V). */}
      <div className="relative bg-primary text-white">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex items-center justify-between">
            <Link href="/learning/marketplace" className="flex cursor-pointer items-center gap-2 text-sm text-slate-300 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              Back to Course Marketplace
            </Link>
            <Link href="/learning/marketplace" aria-label="Close" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-wide text-slate-300 uppercase">{course.categoryName}</p>
              <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-white sm:text-4xl">{course.title}</h1>
              {course.description && (
                <div
                  className="rich-text-content mt-4 text-sm text-slate-300 [&_a]:text-white [&_blockquote]:border-slate-500"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(course.description) }}
                />
              )}
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
                <span className="flex items-center gap-1.5">
                  <PlayCircle className="h-4 w-4" />
                  {formatDeliveryMode(course.deliveryMode)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {course.duration.value} {course.duration.unit}
                </span>
                <span className="flex items-center gap-1.5">
                  <Layers className="h-4 w-4" />
                  {moduleCount} section{moduleCount === 1 ? "" : "s"} · {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Floating preview/purchase card — Udemy-style. Sits in its own grid column rather than
                a true absolute overlap, which stays robust across content lengths. */}
            <div className="lg:-mb-24">
              <div className="overflow-hidden rounded-2xl bg-white text-text shadow-card-lg">
                <div className="aspect-video w-full bg-slate-100">
                  {course.courseImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, no next/image domain config for it
                    <img src={course.courseImageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                      <BookOpen className="h-12 w-12" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <p className="font-heading text-2xl font-bold text-primary">{isPaid ? `$${course.cost!.toFixed(2)}` : "Free"}</p>

                  <div className="mt-4">
                    {isFulfilled ? (
                      <Badge variant="success">Added to your catalog</Badge>
                    ) : isPending ? (
                      <Badge variant="warning">Request pending</Badge>
                    ) : (
                      <Button type="button" className="w-full" onClick={select} isLoading={selecting}>
                        {isPaid ? "Request Access" : "Select this course"}
                      </Button>
                    )}
                  </div>

                  {selectError && (
                    <div role="alert" className="banner-error mt-4">
                      {selectError}
                    </div>
                  )}

                  <ul className="mt-5 space-y-2.5 border-t border-border pt-4 text-sm text-secondary">
                    <li className="flex items-center gap-2.5">
                      <PlayCircle className="h-4 w-4 shrink-0 text-slate-400" />
                      {formatDeliveryMode(course.deliveryMode)}
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                      {course.duration.value} {course.duration.unit} total
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Layers className="h-4 w-4 shrink-0 text-slate-400" />
                      {moduleCount} section{moduleCount === 1 ? "" : "s"}, {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-6 py-10 lg:pt-12">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            {selectOutcome?.outcome === "cloned" && selectOutcome.courseId && (
              <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Added to your catalog.{" "}
                <Link href={`/learning/courses/${selectOutcome.courseId}`} className="font-medium underline">
                  Open it
                </Link>
                .
              </div>
            )}
            {selectOutcome?.outcome === "requested" && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Your request has been sent. A TM admin will confirm payment before this course is added
                to your catalog.
              </div>
            )}

            {course.learningObjectives.length > 0 && (
              <div className="surface-card mb-6">
                <h2 className="font-heading text-lg font-bold text-primary">What you&apos;ll learn</h2>
                <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  {course.learningObjectives.map((objective, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-text">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      {objective}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {course.requirements.length > 0 && (
              <div className="surface-card mb-6">
                <h2 className="font-heading text-lg font-bold text-primary">Requirements</h2>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-text">
                  {course.requirements.map((requirement, i) => (
                    <li key={i}>{requirement}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="surface-card">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold text-primary">Course content</h2>
                {moduleCount > 0 && (
                  <p className="text-sm text-secondary">
                    {moduleCount} section{moduleCount === 1 ? "" : "s"} · {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
                  </p>
                )}
              </div>

              {course.modules.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">No curriculum published yet.</p>
              ) : (
                <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {course.modules.map((module) => {
                    const expanded = expandedModuleIds.has(module.id);
                    return (
                      <div key={module.id} className="bg-white">
                        <button
                          type="button"
                          onClick={() => toggleModule(module.id)}
                          aria-expanded={expanded}
                          className="flex w-full cursor-pointer items-center justify-between gap-4 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
                        >
                          <span className="flex items-center gap-2 font-semibold text-text">
                            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
                            {module.title}
                          </span>
                          <span className="shrink-0 text-xs text-secondary">
                            {module.contentItems.length} lesson{module.contentItems.length === 1 ? "" : "s"}
                          </span>
                        </button>
                        {expanded && (
                          <ul className="divide-y divide-border">
                            {module.contentItems.length === 0 ? (
                              <li className="px-4 py-3 text-sm text-slate-500">No content items yet.</li>
                            ) : (
                              module.contentItems.map((item) => {
                                const Icon = CONTENT_ITEM_ICON[item.type] ?? FileText;
                                return (
                                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                                    <span className="text-sm text-text">{item.title}</span>
                                  </li>
                                );
                              })
                            )}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Empty spacer column on large screens — keeps body content aligned under the hero's left
              column while the purchase card above visually anchors the right column. */}
          <div className="hidden lg:block" />
        </div>
      </div>
    </div>
  );
}
