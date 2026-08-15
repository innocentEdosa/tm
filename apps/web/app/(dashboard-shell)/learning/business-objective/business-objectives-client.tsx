"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, MoreHorizontal, Plus } from "lucide-react";
import { PageHeader, Card, Badge, Modal, Drawer, Button, Pagination, Toast, type ToastVariant } from "@tm/ui";

const API_BASE = "/tenant-api/tenant";
const DISPLAY_PAGE_SIZE = 10;

type Priority = "low" | "medium" | "high";
type Status = "not_started" | "on_track" | "at_risk" | "done";

const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_BADGE: Record<Priority, "neutral" | "warning" | "accent"> = {
  low: "neutral",
  medium: "warning",
  high: "accent",
};

const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  on_track: "On track",
  at_risk: "At risk",
  done: "Done",
};
const STATUS_BADGE: Record<Status, "neutral" | "warning" | "success" | "accent"> = {
  not_started: "neutral",
  on_track: "accent",
  at_risk: "warning",
  done: "success",
};

class ForbiddenError extends Error {}

interface BusinessObjectiveRow {
  id: string;
  title: string;
  categoryId: string;
  categoryName: string | null;
  description: string | null;
  ownerDepartmentId: string;
  ownerDepartmentName: string | null;
  dueDate: string;
  priority: Priority;
  metricName: string;
  baselineValue: number | null;
  targetValue: number | null;
  status: Status;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatMetricValue(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat().format(value);
}

type SortField = "title" | "dueDate" | "priority";

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-1 font-medium text-slate-600 hover:text-primary"
      onClick={onClick}
    >
      {label}
      {active && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
}

const ROW_ACTIONS_MENU_WIDTH = 140;
const ROW_ACTIONS_MENU_HEIGHT = 84;

// Mirrors this codebase's established RowActionsMenu (courses-list-client.tsx, training-needs-client.tsx)
// — portal-based, click-outside-to-close; no shared component exists yet for this pattern.
function RowActionsMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
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

export default function BusinessObjectivesClient({ subdomain, canManage }: { subdomain: string; canManage: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [sortField, setSortField] = useState<SortField>("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const [viewTarget, setViewTarget] = useState<BusinessObjectiveRow | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<BusinessObjectiveRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);

  // One-shot success toast after redirecting back from the full-screen create/edit page
  // (business-objective-form.tsx). Reads the raw URL directly (not next/navigation's
  // useSearchParams) so this client component doesn't need its own Suspense boundary — the flag
  // is stripped from the URL immediately so a refresh doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("created") === "1") {
      setToast({ message: "Objective created.", variant: "success" });
      router.replace("/learning/business-objective");
    } else if (params.get("updated") === "1") {
      setToast({ message: "Objective updated.", variant: "success" });
      router.replace("/learning/business-objective");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowsQuery = useQuery({
    queryKey: ["business-objectives", subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/business-objectives?subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      if (res.status === 403) throw new ForbiddenError();
      if (!res.ok) throw new Error("Couldn't load business objectives. Try again.");
      return (await res.json()) as { data: BusinessObjectiveRow[] };
    },
    retry: false,
  });

  const rows = rowsQuery.error instanceof ForbiddenError ? [] : (rowsQuery.data?.data ?? null);
  const listError =
    rowsQuery.error instanceof ForbiddenError
      ? "You don't have access to view business objectives."
      : rowsQuery.error
        ? (rowsQuery.error as Error).message
        : null;

  const sorted = useMemo(() => {
    if (!rows) return [];
    const copy = [...rows];
    copy.sort((a, b) => {
      let result = 0;
      if (sortField === "title") result = a.title.localeCompare(b.title);
      else if (sortField === "dueDate") result = a.dueDate.localeCompare(b.dueDate);
      else if (sortField === "priority") {
        const order: Record<Priority, number> = { low: 0, medium: 1, high: 2 };
        result = order[a.priority] - order[b.priority];
      }
      return sortDir === "asc" ? result : -result;
    });
    return copy;
  }, [rows, sortField, sortDir]);

  const paged = sorted.slice((page - 1) * DISPLAY_PAGE_SIZE, page * DISPLAY_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const deleteMutation = useMutation({
    mutationFn: async (target: BusinessObjectiveRow) => {
      const res = await fetch(
        `${API_BASE}/business-objectives/${target.id}?subdomain=${encodeURIComponent(subdomain)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't delete this business objective.");
      }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      setToast({ message: "Objective deleted.", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["business-objectives", subdomain] });
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteError(null);
    deleteMutation.mutate(deleteTarget);
  }

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader title="Business objectives" subtitle="Company-level goals, their owners, and progress toward target." />
        {canManage && (
          <Button onClick={() => router.push("/learning/business-objective/new")}>
            <Plus className="h-4 w-4" />
            Add objective
          </Button>
        )}
      </div>

      {listError && <div className="banner-error mt-4">{listError}</div>}

      <Card className="mt-4 overflow-hidden p-0">
        {rows === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {canManage
              ? "No business objectives yet — create your first one to get started."
              : "No business objectives yet."}
          </div>
        ) : (
          <table className="w-full table-fixed divide-y divide-border text-sm">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[18%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[18%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left whitespace-nowrap">
                  <SortHeader label="Objective" active={sortField === "title"} dir={sortDir} onClick={() => toggleSort("title")} />
                </th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Owner</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">
                  <SortHeader label="Due date" active={sortField === "dueDate"} dir={sortDir} onClick={() => toggleSort("dueDate")} />
                </th>
                <th className="px-4 py-2 text-left whitespace-nowrap">
                  <SortHeader label="Priority" active={sortField === "priority"} dir={sortDir} onClick={() => toggleSort("priority")} />
                </th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Progress</th>
                {canManage && <th className="px-4 py-2 text-right font-medium whitespace-nowrap text-slate-600">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-border hover:bg-slate-50"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
                    setViewTarget(row);
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="truncate text-sm font-medium text-primary" title={row.title}>
                      {row.title}
                    </div>
                    {row.description && (
                      <div className="truncate text-xs text-slate-500" title={row.description}>
                        {row.description}
                      </div>
                    )}
                  </td>
                  <td className="truncate px-4 py-3 text-sm text-secondary" title={row.ownerDepartmentName ?? ""}>
                    {row.ownerDepartmentName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">{formatDate(row.dueDate)}</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={PRIORITY_BADGE[row.priority]}>{PRIORITY_LABEL[row.priority]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">
                    {formatMetricValue(row.baselineValue)} → {formatMetricValue(row.targetValue)}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right text-sm">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          onEdit={() => router.push(`/learning/business-objective/${row.id}/edit`)}
                          onDelete={() => {
                            setDeleteError(null);
                            setDeleteTarget(row);
                          }}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {sorted.length > 0 && (
        <Pagination className="mt-3" page={page} pageSize={DISPLAY_PAGE_SIZE} total={sorted.length} onPageChange={setPage} />
      )}

      <Drawer open={!!viewTarget} onClose={() => setViewTarget(null)} side="right" title={viewTarget?.title ?? ""}>
        {viewTarget && (
          <div className="space-y-5">
            {viewTarget.description && (
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Description</p>
                <p className="mt-1 text-sm text-primary">{viewTarget.description}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Category</p>
                <p className="mt-1 text-sm text-primary">{viewTarget.categoryName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Owner</p>
                <p className="mt-1 text-sm text-primary">{viewTarget.ownerDepartmentName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Due date</p>
                <p className="mt-1 text-sm text-primary">{formatDate(viewTarget.dueDate)}</p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Priority</p>
                <p className="mt-1">
                  <Badge variant={PRIORITY_BADGE[viewTarget.priority]}>{PRIORITY_LABEL[viewTarget.priority]}</Badge>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Status</p>
                <p className="mt-1">
                  <Badge variant={STATUS_BADGE[viewTarget.status]}>{STATUS_LABEL[viewTarget.status]}</Badge>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Progress</p>
                <p className="mt-1 text-sm text-primary">
                  {formatMetricValue(viewTarget.baselineValue)} → {formatMetricValue(viewTarget.targetValue)}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Metric / Key Result</p>
              <p className="mt-1 text-sm text-primary">{viewTarget.metricName}</p>
            </div>

            {viewTarget.createdByName && (
              <p className="text-xs text-slate-500">
                Created by {viewTarget.createdByName} on {formatDate(viewTarget.createdAt.slice(0, 10))}
              </p>
            )}

            {canManage && (
              <div className="flex justify-end border-t border-border pt-4">
                <Button
                  onClick={() => router.push(`/learning/business-objective/${viewTarget.id}/edit`)}
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        title={`Delete "${deleteTarget?.title ?? ""}"?`}
      >
        <div className="space-y-4">
          {deleteError && <div className="banner-error">{deleteError}</div>}
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to delete this business objective?</p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button isLoading={deleteMutation.isPending} onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </main>
  );
}
