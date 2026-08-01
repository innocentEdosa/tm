"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, MoreHorizontal } from "lucide-react";
import { PageHeader, Card, Badge, Modal, Button, Pagination } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { SubdomainProvider, useSubdomain } from "@/lib/subdomain-context";
import type { Course, CourseStatus } from "@/lib/course-api-types";
import CreateCourseMenu from "./create-course-menu";

const STATUS_LABEL: Record<CourseStatus, string> = { active: "Published", draft: "Draft", archived: "Archived" };
const STATUS_DOT: Record<CourseStatus, string> = { active: "bg-green-600", draft: "bg-slate-400", archived: "bg-slate-400" };
const STATUS_BADGE_VARIANT: Record<CourseStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  draft: "neutral",
  archived: "neutral",
};

const ROW_ACTIONS_MENU_WIDTH = 140;
const ROW_ACTIONS_MENU_HEIGHT = 84;

// Mirrors training-needs-client.tsx's own RowActionsMenu exactly (portal-based, click-outside-to-close) —
// no shared component exists yet for this pattern in this codebase.
function RowActionsMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current && !buttonRef.current.contains(target) && menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < ROW_ACTIONS_MENU_HEIGHT ? rect.top - ROW_ACTIONS_MENU_HEIGHT : rect.bottom + 4;
      const left = rect.right - ROW_ACTIONS_MENU_WIDTH;
      setPosition({ top, left });
    }
    setOpen((prev) => !prev);
  }

  return (
    <div data-row-actions>
      <button
        ref={buttonRef}
        type="button"
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary"
        aria-label="Row actions"
        onClick={toggleOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            data-row-actions
            style={{ top: position.top, left: position.left, width: ROW_ACTIONS_MENU_WIDTH }}
            className="fixed z-50 rounded-lg border border-border bg-white py-1 shadow-card-md"
          >
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <button type="button" className="flex cursor-pointer items-center gap-1 font-medium text-slate-600 hover:text-primary" onClick={onClick}>
      {label}
      {active && (dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
    </button>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

type SortField = "title" | "createdAt";

// The real GET /tenant/courses endpoint only supports a fixed createdAt-desc order (no arbitrary
// sort-field param) — a generous pageSize pulls effectively every course for a typical tenant's
// catalog in one request, so title-sort and pagination can still happen client-side exactly like
// before, rather than losing that UX or building a whole server-side sort-field feature for it.
const FETCH_PAGE_SIZE = 200;
const DISPLAY_PAGE_SIZE = 10;

function CoursesListInner({ canManage }: { canManage: boolean }) {
  const subdomain = useSubdomain();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<"" | CourseStatus>("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);

  const coursesQuery = useQuery({
    queryKey: ["courses", subdomain, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: String(FETCH_PAGE_SIZE) });
      if (statusFilter) params.set("status", statusFilter);
      return tenantFetch<{ data: Course[] }>(`/courses?${params.toString()}`, { subdomain });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (courseId: string) => tenantFetch(`/courses/${courseId}`, { method: "DELETE", subdomain }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses", subdomain] });
    },
  });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  }

  const courses = coursesQuery.data?.data ?? null;
  const sorted = courses
    ? [...courses].sort((a, b) => {
        const result = sortField === "title" ? a.title.localeCompare(b.title) : a.createdAt.localeCompare(b.createdAt);
        return sortDir === "asc" ? result : -result;
      })
    : [];
  const paged = sorted.slice((page - 1) * DISPLAY_PAGE_SIZE, page * DISPLAY_PAGE_SIZE);

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader title="Courses" />
        {canManage && <CreateCourseMenu />}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <select
          className="field-input max-w-xs"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as "" | CourseStatus);
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="active">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <Card className="mt-4 overflow-hidden p-0">
        {courses === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : coursesQuery.isError ? (
          <div className="p-8 text-center text-sm text-red-600">Couldn&apos;t load courses. Try refreshing.</div>
        ) : courses.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No courses yet.</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No courses match this filter.</div>
        ) : (
          <table className="w-full table-fixed divide-y divide-border text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-[32%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              {canManage && <col className="w-16" />}
            </colgroup>
            <thead className="bg-slate-50">
              <tr>
                <th className="w-10 px-4 py-2" />
                <th className="px-4 py-2 text-left">
                  <SortHeader label="Title" active={sortField === "title"} dir={sortDir} onClick={() => toggleSort("title")} />
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Category</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Modules</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2 text-left">
                  <SortHeader label="Created" active={sortField === "createdAt"} dir={sortDir} onClick={() => toggleSort("createdAt")} />
                </th>
                {canManage && <th className="px-4 py-2 text-right font-medium text-slate-600">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paged.map((course) => (
                <tr
                  key={course.id}
                  className="cursor-pointer border-t border-border hover:bg-slate-50"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
                    router.push(`/learning/courses/${course.id}`);
                  }}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="cursor-pointer" aria-label={`Select ${course.title}`} />
                  </td>
                  <td className="truncate px-4 py-3 text-sm font-medium text-primary" title={course.title}>
                    {course.title}
                  </td>
                  <td className="truncate px-4 py-3 text-sm text-secondary">{course.category?.name ?? "Uncategorized"}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{course.moduleCount}</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={STATUS_BADGE_VARIANT[course.status]}>
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[course.status]}`} />
                      {STATUS_LABEL[course.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary">{formatDate(course.createdAt)}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <RowActionsMenu onEdit={() => router.push(`/learning/courses/${course.id}`)} onDelete={() => setDeleteTarget(course)} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {sorted.length > 0 && <Pagination className="mt-3" page={page} pageSize={DISPLAY_PAGE_SIZE} total={sorted.length} onPageChange={setPage} />}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={`Delete "${deleteTarget?.title ?? ""}"?`}>
        <div className="space-y-4">
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to delete this course?</p>
          {deleteMutation.isError && <p className="banner-error">{(deleteMutation.error as Error).message}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!deleteTarget) return;
                deleteMutation.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
              }}
              isLoading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

/**
 * Client Component: lists every real course in this tenant's catalog. Table layout mirrors
 * training-needs-client.tsx's established table/RowActionsMenu/Pagination conventions.
 */
export default function CoursesListClient({ canManage, subdomain }: { canManage: boolean; subdomain: string }) {
  return (
    <SubdomainProvider subdomain={subdomain}>
      <CoursesListInner canManage={canManage} />
    </SubdomainProvider>
  );
}
