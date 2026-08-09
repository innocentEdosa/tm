"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, File as FileIcon, Link as LinkIcon, Star, X } from "lucide-react";
import { Button } from "@tm/ui";
import { tenantFetch, openAttachment } from "@/lib/tenant-api-client";
import { SubdomainProvider, useSubdomain } from "@/lib/subdomain-context";
import { flattenCourseOutline, type Course, type Curriculum, type Attachment, type ContentItem, type CourseReview } from "@/lib/course-api-types";
import PlayerSidebar from "./player-sidebar";
import LessonMedia from "./player-content";
import PlayerTabs from "./player-tabs";
import LeaveRatingModal from "./leave-rating-modal";

type ProgressStatus = "not_started" | "in_progress" | "completed" | "failed";

interface ProgressRow {
  contentItemId: string;
  status: ProgressStatus;
}

function ResourceRow({ resource, subdomain }: { resource: Attachment; subdomain: string }) {
  return (
    <button
      type="button"
      onClick={() => openAttachment(resource, subdomain)}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
    >
      {resource.kind === "link" ? <LinkIcon className="h-4 w-4 shrink-0 text-slate-400" /> : <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />}
      <span className="truncate text-primary">{resource.fileName}</span>
    </button>
  );
}

function ResourcesPanel({ contentItemId, subdomain }: { contentItemId: string; subdomain: string }) {
  const { data: resources } = useQuery({
    queryKey: ["player-attachments", contentItemId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Attachment[] }>(`/content-items/${contentItemId}/attachments`, { subdomain });
      return data;
    },
  });

  if (!resources || resources.length === 0) return null;

  return (
    <div className="mx-1 rounded-xl border border-border bg-white">
      <p className="border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-secondary uppercase">Resources</p>
      {resources.map((r) => (
        <ResourceRow key={r.id} resource={r} subdomain={subdomain} />
      ))}
    </div>
  );
}

function CoursePlayerInner({ courseId, initialContentItemId }: { courseId: string; initialContentItemId: string | null }) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();
  const [activeItemId, setActiveItemId] = useState<string | null>(initialContentItemId);
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const markedInProgressRef = useRef<Set<string>>(new Set());

  const myReviewQuery = useQuery({
    queryKey: ["player-my-review", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseReview | null }>(`/courses/${courseId}/reviews/mine?asLearner=true`, { subdomain });
      return data;
    },
  });

  const courseQuery = useQuery({
    queryKey: ["player-course", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Course }>(`/courses/${courseId}?asLearner=true`, { subdomain });
      return data;
    },
  });

  const curriculumQuery = useQuery({
    queryKey: ["player-curriculum", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Curriculum }>(`/courses/${courseId}/curriculum?asLearner=true`, { subdomain });
      return data;
    },
  });

  const progressQuery = useQuery({
    queryKey: ["player-progress", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: ProgressRow[] }>(`/courses/${courseId}/progress`, { subdomain });
      return data;
    },
  });

  const flattened = useMemo(() => (curriculumQuery.data ? flattenCourseOutline(curriculumQuery.data) : []), [curriculumQuery.data]);
  const progressByItemId = useMemo(() => new Map((progressQuery.data ?? []).map((p) => [p.contentItemId, p.status])), [progressQuery.data]);

  // Pick a starting lesson once the curriculum loads: the deep-linked item if it's still valid,
  // otherwise the first not-yet-completed item, falling back to the very first item.
  useEffect(() => {
    if (flattened.length === 0 || activeItemId) return;
    const valid = initialContentItemId && flattened.some((i) => i.id === initialContentItemId);
    if (valid) {
      setActiveItemId(initialContentItemId);
      return;
    }
    const nextIncomplete = flattened.find((i) => progressByItemId.get(i.id) !== "completed");
    setActiveItemId((nextIncomplete ?? flattened[0]).id);
  }, [flattened, activeItemId, initialContentItemId, progressByItemId]);

  const activeItem: ContentItem | null = flattened.find((i) => i.id === activeItemId) ?? null;
  const activeIndex = activeItem ? flattened.findIndex((i) => i.id === activeItem.id) : -1;
  const prevItem = activeIndex > 0 ? flattened[activeIndex - 1] : null;
  const nextItem = activeIndex >= 0 && activeIndex < flattened.length - 1 ? flattened[activeIndex + 1] : null;

  const totalItems = flattened.length;
  const completedItems = flattened.filter((i) => progressByItemId.get(i.id) === "completed").length;
  const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  async function setProgress(contentItemId: string, status: ProgressStatus) {
    await tenantFetch(`/content-items/${contentItemId}/progress`, { method: "PUT", subdomain, body: { status } });
    queryClient.invalidateQueries({ queryKey: ["player-progress", courseId, subdomain] });
  }

  // A SCORM item's own SCO commits progress via `window.API` (`scorm-embed.tsx`) — the generic
  // endpoint is only for every other content type, so entering/toggling a SCORM item never calls it.
  function isScormItem(item: ContentItem): boolean {
    return item.type === "external_import" && item.payload.sourceType === "scorm";
  }

  useEffect(() => {
    if (!activeItem || isScormItem(activeItem)) return;
    if (markedInProgressRef.current.has(activeItem.id)) return;
    if (progressByItemId.get(activeItem.id) && progressByItemId.get(activeItem.id) !== "not_started") return;
    markedInProgressRef.current.add(activeItem.id);
    setProgress(activeItem.id, "in_progress");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per lesson entered, not on every progress refetch
  }, [activeItem?.id]);

  function toggleComplete(item: ContentItem) {
    if (isScormItem(item)) return;
    const current = progressByItemId.get(item.id) ?? "not_started";
    setProgress(item.id, current === "completed" ? "in_progress" : "completed");
  }

  if (courseQuery.isError || curriculumQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="banner-error">Couldn&apos;t load this course. Try again from My Courses.</p>
      </div>
    );
  }

  if (!courseQuery.data || !curriculumQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-300 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/learning/my-courses" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-slate-100" title="Back to My Courses">
            <X className="h-4 w-4" />
          </Link>
          <p className="truncate text-sm font-semibold text-primary">{courseQuery.data.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setRatingModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-secondary hover:bg-slate-100 hover:text-primary"
          >
            <Star className="h-4 w-4" />
            {myReviewQuery.data ? "Update your rating" : "Leave a rating"}
          </button>
          <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-slate-200 sm:block">
            <div className="h-full rounded-full bg-cta transition-all" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-xs font-medium text-secondary">{percent}% complete</span>
        </div>
      </header>

      <LeaveRatingModal
        open={ratingModalOpen}
        onClose={() => setRatingModalOpen(false)}
        courseId={courseId}
        myReview={myReviewQuery.data ?? null}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white">
          {activeItem ? (
            <>
              <div className="bg-black">
                <LessonMedia item={activeItem} onVideoEnded={() => setProgress(activeItem.id, "completed")} />
              </div>

              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <button
                  type="button"
                  disabled={!prevItem}
                  onClick={() => prevItem && setActiveItemId(prevItem.id)}
                  className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-secondary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button
                  type="button"
                  disabled={!nextItem}
                  onClick={() => nextItem && setActiveItemId(nextItem.id)}
                  className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-secondary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <PlayerTabs
                courseId={courseId}
                overview={
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <h1 className="text-lg font-semibold text-primary">{activeItem.title}</h1>
                      {!isScormItem(activeItem) && (
                        <Button
                          variant={progressByItemId.get(activeItem.id) === "completed" ? "secondary" : "primary"}
                          size="sm"
                          className="shrink-0"
                          onClick={() => toggleComplete(activeItem)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {progressByItemId.get(activeItem.id) === "completed" ? "Completed" : "Mark as complete"}
                        </Button>
                      )}
                    </div>
                    {activeItem.description && <p className="text-sm text-secondary">{activeItem.description}</p>}
                    <ResourcesPanel contentItemId={activeItem.id} subdomain={subdomain} />
                  </div>
                }
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">This course doesn&apos;t have any content yet.</div>
          )}
        </main>

        <aside className="hidden w-96 shrink-0 overflow-y-auto border-l border-border bg-white lg:block">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-primary">Course content</p>
            <p className="text-xs text-muted">
              {completedItems} / {totalItems} complete
            </p>
          </div>
          <PlayerSidebar
            curriculum={curriculumQuery.data}
            activeItemId={activeItemId}
            progressByItemId={progressByItemId}
            onSelectItem={(item) => setActiveItemId(item.id)}
            onToggleComplete={toggleComplete}
          />
        </aside>
      </div>
    </div>
  );
}

export default function CoursePlayerClient({
  courseId,
  subdomain,
  initialContentItemId,
}: {
  courseId: string;
  subdomain: string;
  initialContentItemId: string | null;
}) {
  return (
    <SubdomainProvider subdomain={subdomain}>
      <CoursePlayerInner courseId={courseId} initialContentItemId={initialContentItemId} />
    </SubdomainProvider>
  );
}
