"use client";

// Course Marketplace spec (029), User Stories 1/2 — platform course metadata edit + curriculum
// builder. UI-reuse follow-up: this now reuses the exact same Information/Curriculum tab components
// the tenant course editor uses (`(dashboard-shell)/learning/courses/[courseId]/`), backed by
// `platformCourseEditorApi()` instead of a tenant `tenantCourseEditorApi(subdomain)` — see
// `apps/web/lib/course-editor-adapter.ts`'s own doc comment for what that adapter covers and the
// handful of tenant-only capabilities (course image, standalone lessons, per-item draft/published
// toggle, link-type resources, real SCORM import) it deliberately doesn't extend to platform courses.
// "Settings" (tenant course-assignment) has no platform equivalent (there's no tenant to assign to at
// the platform level) and is omitted; "Performance" here means tenant adoption, not learner progress
// (a platform course has no direct learners of its own — only each tenant's clone does).
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ApiResponse } from "@tm/types";
import { Badge, Button } from "@tm/ui";
import { CourseEditorApiProvider } from "@/lib/course-editor-context";
import { platformCourseEditorApi } from "@/lib/course-editor-adapter";
import InformationTab from "@/app/(dashboard-shell)/learning/courses/[courseId]/information-tab";
import PlatformCoursePerformancePanel from "./platform-course-performance-panel";

const CurriculumShell = dynamic(() => import("@/app/(dashboard-shell)/learning/courses/[courseId]/curriculum-shell"), {
  ssr: false,
  loading: () => <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-300 border-t-transparent" />,
});

const API_BASE = "/platform-api";

interface PlatformCourseHeader {
  id: string;
  title: string;
  status: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; data: PlatformCourseHeader };

type TopTab = "information" | "curriculum" | "performance";
const TOP_TABS: { id: TopTab; label: string }[] = [
  { id: "information", label: "Information" },
  { id: "curriculum", label: "Curriculum" },
  { id: "performance", label: "Performance" },
];

function statusBadgeVariant(status: string): "success" | "accent" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "draft") return "neutral";
  return "warning";
}

export default function PlatformCourseDetailPage() {
  const router = useRouter();
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const api = useMemo(() => platformCourseEditorApi(), []);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<TopTab>("information");

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    fetch(`${API_BASE}/admin/platform-courses/${courseId}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthenticated" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as ApiResponse<PlatformCourseHeader>;
        setState({ status: "ready", data: json.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [courseId, reloadToken]);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/platform/login");
    }
  }, [state.status, router]);

  async function setStatus(status: string) {
    setActionError(null);
    const res = await fetch(`${API_BASE}/admin/platform-courses/${courseId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = (await res.json()) as ApiResponse<unknown>;
    if (!res.ok || !json.success) {
      setActionError(json.message ?? "Couldn't update status.");
      return;
    }
    setReloadToken((t) => t + 1);
  }

  if (state.status === "loading" || state.status === "unauthenticated") {
    return <p className="mx-auto max-w-5xl text-sm text-slate-600">Loading…</p>;
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="banner-error mx-auto max-w-5xl">
        Couldn&apos;t load this course.
      </div>
    );
  }

  const course = state.data;

  return (
    <CourseEditorApiProvider api={api}>
      <div className="mx-auto max-w-5xl">
        <Link href="/admin/course-marketplace" className="cursor-pointer text-sm text-cta hover:underline">
          ← Back to Course Marketplace
        </Link>

        <div className="mb-4 mt-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-primary">{course.title}</h1>
            <Badge variant={statusBadgeVariant(course.status)}>{course.status}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {course.status !== "active" && (
              <Button type="button" onClick={() => setStatus("active")}>
                Publish
              </Button>
            )}
            {course.status === "active" && (
              <Button type="button" variant="outline" onClick={() => setStatus("archived")}>
                Archive
              </Button>
            )}
          </div>
        </div>

        {actionError && (
          <div role="alert" className="banner-error mb-4">
            {actionError}
          </div>
        )}

        <div className="mb-6 flex gap-6 border-b border-border">
          {TOP_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`-mb-px cursor-pointer border-b-2 pb-3 text-xs font-semibold tracking-wide capitalize ${
                tab === t.id ? "border-accent text-primary" : "border-transparent text-muted hover:text-primary"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "information" && <InformationTab courseId={courseId} readOnly={false} />}
        {tab === "curriculum" && <CurriculumShell courseId={courseId} readOnly={false} />}
        {tab === "performance" && <PlatformCoursePerformancePanel courseId={courseId} />}
      </div>
    </CourseEditorApiProvider>
  );
}
