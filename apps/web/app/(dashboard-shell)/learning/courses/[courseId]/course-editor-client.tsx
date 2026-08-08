"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import { Card, Badge, Button, Modal, Popover } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { SubdomainProvider, useSubdomain } from "@/lib/subdomain-context";
import { CourseEditorApiProvider, useCourseEditorApi } from "@/lib/course-editor-context";
import { tenantCourseEditorApi } from "@/lib/course-editor-adapter";
import type { Course, CourseStatus, Curriculum } from "@/lib/course-api-types";
import InformationTab from "./information-tab";
import PerformanceShell from "./performance-shell";
import SettingsTab from "./settings-tab";

// Drag-and-drop (@dnd-kit/*) is only needed once the Curriculum tab is opened, and is pure client
// interaction with no SEO value — code-split it out of the route's initial bundle instead of paying
// for it on every course-editor visit, even ones that never leave the Information tab.
const CurriculumShell = dynamic(() => import("./curriculum-shell"), {
  ssr: false,
  loading: () => <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-300 border-t-transparent" />,
});

const STATUS_BADGE_VARIANT: Record<CourseStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
};
const STATUS_LABEL: Record<CourseStatus, string> = { active: "Published", draft: "Draft", archived: "Archived" };

type TopTab = "information" | "curriculum" | "settings" | "performance";

const TOP_TABS: { id: TopTab; label: string }[] = [
  { id: "information", label: "Information" },
  { id: "curriculum", label: "Curriculum" },
  { id: "settings", label: "Settings" },
  { id: "performance", label: "Performance" },
];

function CourseEditorInner({ courseId, canManage, currentUserEmail }: { courseId: string; canManage: boolean; currentUserEmail: string }) {
  const subdomain = useSubdomain();
  const router = useRouter();
  const queryClient = useQueryClient();
  const api = useCourseEditorApi();

  const courseQuery = useQuery({
    queryKey: ["course", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}`, { subdomain });
      return data;
    },
  });
  // Shares its cache entry with `curriculum-tab.tsx`'s own fetch of the same query key — fetched here
  // just for the lesson count in the header, not refetched twice.
  const curriculumQuery = useQuery({
    queryKey: ["course-curriculum", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Curriculum }>(`/courses/${courseId}/curriculum`, { subdomain });
      return data;
    },
  });

  const [tab, setTab] = useState<TopTab>("information");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: (status: CourseStatus) => tenantFetch(`/courses/${courseId}`, { method: "PATCH", subdomain, body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course", courseId, subdomain] }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => tenantFetch(`/courses/${courseId}`, { method: "DELETE", subdomain }),
    onSuccess: () => router.push("/learning/courses"),
    onError: (err: Error) => setDeleteError(err.message),
  });
  const applyUpdateMutation = useMutation({
    mutationFn: () => api.applyMarketplaceUpdate!(courseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course", courseId, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["course-curriculum", courseId, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["courses", subdomain] });
    },
  });
  const dismissUpdateMutation = useMutation({
    mutationFn: () => api.dismissMarketplaceUpdate!(courseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course", courseId, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["courses", subdomain] });
    },
  });

  const course = courseQuery.data;
  if (!course) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-6">
        {courseQuery.isError ? <p className="banner-error">Couldn&apos;t load this course. Try refreshing.</p> : <p className="text-sm text-muted">Loading…</p>}
      </main>
    );
  }

  const moduleCount = course.moduleCount;
  const lessonCount = curriculumQuery.data
    ? curriculumQuery.data.modules.reduce((sum, m) => sum + (m.contentItems?.length ?? 0), 0) + curriculumQuery.data.standaloneContentItems.length
    : 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-primary">{course.title}</h1>
            <Badge variant={STATUS_BADGE_VARIANT[course.status]}>{STATUS_LABEL[course.status]}</Badge>
            {course.updateAvailable && <Badge variant="warning">Update available</Badge>}
          </div>
          {(moduleCount > 0 || lessonCount > 0) && (
            <p className="mt-1 text-sm text-muted">
              {[
                moduleCount > 0 ? `${moduleCount} module${moduleCount === 1 ? "" : "s"}` : null,
                lessonCount > 0 ? `${lessonCount} lesson${lessonCount === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canManage && course.updateAvailable && (
            <>
              <Button variant="outline" onClick={() => dismissUpdateMutation.mutate()} isLoading={dismissUpdateMutation.isPending}>
                Dismiss update
              </Button>
              <Button onClick={() => applyUpdateMutation.mutate()} isLoading={applyUpdateMutation.isPending}>
                Apply update
              </Button>
            </>
          )}
          {canManage && (
            <Popover
              align="end"
              width={170}
              trigger={
                <button type="button" aria-label="More actions" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50">
                  <MoreVertical className="h-4 w-4" />
                </button>
              }
            >
              {(close) => (
                <button
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  onClick={() => {
                    close();
                    setDeleteOpen(true);
                  }}
                >
                  Delete course
                </button>
              )}
            </Popover>
          )}
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          {canManage && course.status === "draft" && (
            <Button onClick={() => statusMutation.mutate("active")} isLoading={statusMutation.isPending}>
              Publish Course
            </Button>
          )}
          {canManage && course.status === "active" && (
            <Button variant="outline" onClick={() => statusMutation.mutate("draft")} isLoading={statusMutation.isPending}>
              Unpublish
            </Button>
          )}
        </div>
      </div>

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

      {!canManage && <Card className="mb-4">You have read-only access to this course.</Card>}

      {tab === "information" && <InformationTab courseId={courseId} readOnly={!canManage} />}
      {tab === "curriculum" && <CurriculumShell courseId={courseId} readOnly={!canManage} />}
      {tab === "settings" && <SettingsTab courseId={courseId} readOnly={!canManage} />}
      {tab === "performance" && <PerformanceShell courseId={courseId} courseName={course.title} readOnly={!canManage} currentUserEmail={currentUserEmail} />}

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview">
        <p className="text-sm text-secondary">Course preview isn&apos;t available yet.</p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`Delete "${course.title}"?`}>
        <div className="space-y-4">
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to delete this course?</p>
          {deleteError && <p className="banner-error">{deleteError}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => deleteMutation.mutate()} isLoading={deleteMutation.isPending}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

/**
 * The course editor shell — a header (title, status, overflow menu, Preview/Publish) plus top-level
 * Information/Curriculum/Performance tabs, mirroring the reference course-authoring product's layout.
 */
export default function CourseEditorClient({
  courseId,
  canManage,
  currentUserEmail,
  subdomain,
}: {
  courseId: string;
  canManage: boolean;
  currentUserEmail: string;
  subdomain: string;
}) {
  const api = useMemo(() => tenantCourseEditorApi(subdomain), [subdomain]);
  return (
    <SubdomainProvider subdomain={subdomain}>
      <CourseEditorApiProvider api={api}>
        <CourseEditorInner courseId={courseId} canManage={canManage} currentUserEmail={currentUserEmail} />
      </CourseEditorApiProvider>
    </SubdomainProvider>
  );
}
