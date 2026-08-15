"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Users } from "lucide-react";
import { Button } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import { aggregateLearnerProgress, type Curriculum, type CourseLearnerProgressRow, type CourseLearnerSummary } from "@/lib/course-api-types";

const PAGE_SIZE = 10;

function LearnerAvatar({ name }: { name: string }) {
  return <span className="shell-profile-avatar">{name.charAt(0).toUpperCase()}</span>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function downloadCsv(courseName: string, learners: CourseLearnerSummary[]) {
  const header = "Name,Email,Progress,Enrolled\n";
  const rows = learners.map((l) => `"${l.name}","${l.email}",${l.progressPercent}%,${formatDate(l.enrolledAt)}`).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${courseName.replace(/\s+/g, "-").toLowerCase()}-learners.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

type SortKey = "name" | "enrolledAt";
type SortDirection = "asc" | "desc";

function SortableHeader({ label, active, direction, onClick }: { label: string; active: boolean; direction: SortDirection; onClick: () => void }) {
  return (
    <button type="button" className="flex cursor-pointer items-center gap-1 hover:text-primary" onClick={onClick}>
      {label}
      {active && (direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
}

/**
 * Performance > Learners (the reference product's "Subscribers", renamed) — every learner who has
 * touched this course's content and their overall completion. There's no server-side course-level
 * progress rollup (spec 026 deliberately scoped that out — a progress row exists per learner per
 * content item, not per course), so this aggregates `GET .../progress/learners` client-side against
 * the course's total content-item count (from the same curriculum data the Curriculum tab uses —
 * shares its query cache). Sortable by name/enrolled date, with a client-side CSV export.
 */
export default function LearnersTab({ courseId, courseName }: { courseId: string; courseName: string }) {
  const subdomain = useSubdomain();

  const curriculumQuery = useQuery({
    queryKey: ["course-curriculum", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Curriculum }>(`/courses/${courseId}/curriculum`, { subdomain });
      return data;
    },
  });
  const progressQuery = useQuery({
    queryKey: ["course-learner-progress", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseLearnerProgressRow[] }>(`/courses/${courseId}/progress/learners`, { subdomain });
      return data;
    },
  });

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);

  const totalContentItems = curriculumQuery.data
    ? curriculumQuery.data.modules.reduce((sum, m) => sum + (m.contentItems?.length ?? 0), 0) + curriculumQuery.data.standaloneContentItems.length
    : 0;
  const learners = progressQuery.data ? aggregateLearnerProgress(progressQuery.data, totalContentItems) : [];

  const sorted = useMemo(() => {
    const copy = [...learners];
    copy.sort((a, b) => {
      const cmp = sortKey === "name" ? a.name.localeCompare(b.name) : a.enrolledAt.localeCompare(b.enrolledAt);
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learners.length, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    setPage(1);
  }

  if (progressQuery.isError) {
    return <p className="banner-error">Couldn&apos;t load learner progress. Try refreshing.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-primary">Learners</h2>
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border px-2 text-xs font-medium text-secondary">
            {learners.length}
          </span>
        </div>
        {learners.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => downloadCsv(courseName, sorted)}>
            Download List
          </Button>
        )}
      </div>

      {learners.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
          <Users className="h-8 w-8 text-muted" />
          <p className="font-semibold text-primary">No learners yet</p>
          <p className="max-w-sm text-sm text-muted">Once people enroll in this course, their progress will show up here.</p>
        </div>
      ) : (
        <>
          <table className="w-full table-fixed divide-y divide-border text-sm">
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[36%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">
                  <SortableHeader label="Name" active={sortKey === "name"} direction={sortDirection} onClick={() => toggleSort("name")} />
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Progress</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">
                  <SortableHeader label="Enrolled" active={sortKey === "enrolledAt"} direction={sortDirection} onClick={() => toggleSort("enrolledAt")} />
                </th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((learner) => (
                <tr key={learner.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <LearnerAvatar name={learner.name} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-primary">{learner.name}</p>
                        <p className="truncate text-sm text-muted">{learner.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-cta" style={{ width: `${learner.progressPercent}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-secondary">{learner.progressPercent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-secondary">{formatDate(learner.enrolledAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
