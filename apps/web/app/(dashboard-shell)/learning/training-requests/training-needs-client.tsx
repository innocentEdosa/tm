"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus } from "lucide-react";
import { PageHeader, Card, Badge, Modal, Button, Pagination } from "@tm/ui";
import { STATUS_LABEL, STATUS_BADGE_VARIANT, type TrainingNeedStatus } from "./status";

const API_BASE = "/tenant-api/tenant";

type Priority = "low" | "medium" | "high";

const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_BADGE: Record<Priority, "neutral" | "warning" | "accent"> = {
  low: "neutral",
  medium: "warning",
  high: "accent",
};

interface TrainingNeedRow {
  id: string;
  departmentId: string;
  departmentName: string | null;
  title: string;
  priority: Priority;
  status: TrainingNeedStatus;
  createdByUserId: string | null;
  createdByName: string | null;
  submittedAt: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

interface DepartmentOption {
  id: string;
  name: string;
}

const ROW_ACTIONS_MENU_WIDTH = 140;
const ROW_ACTIONS_MENU_HEIGHT = 84;

// Mirrors Department/Team's own RowActionsMenu exactly (portal-based, click-outside-to-close) —
// research.md §6/§7, no shared component exists yet for this pattern in this codebase.
function RowActionsMenu({
  canDelete,
  onEdit,
  onDelete,
}: {
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
            {canDelete && (
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
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function TrainingNeedsClient({
  subdomain,
  canViewAll,
  canManageAll,
  canManageDepartment,
}: {
  subdomain: string;
  canViewAll: boolean;
  canManageAll: boolean;
  canManageDepartment: boolean;
}) {
  const router = useRouter();
  const canManage = canManageAll || canManageDepartment;

  const [rows, setRows] = useState<TrainingNeedRow[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Filters — org-wide (training_request.view.all) only (spec US2/contracts §GET list); a department-scoped
  // Manager's own list is small and unpaginated, no filter bar needed (research.md Scale/Scope).
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Only fetched for training_request.view.all (org-wide filter bar) — a plain department-scoped Manager may not
  // hold department.view, so this fetch is skipped entirely for them.
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<TrainingNeedRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewAll) return;
    fetch(`${API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json: { data: DepartmentOption[] }) => setDepartments(json.data))
      .catch(() => setDepartments([]));
  }, [subdomain, canViewAll]);

  function loadRows() {
    const params = new URLSearchParams({ subdomain });
    if (canViewAll) {
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (departmentFilter) params.set("department", departmentFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      if (statusFilter) params.set("status", statusFilter);
    }
    fetch(`${API_BASE}/training-needs?${params.toString()}`, { credentials: "include" })
      .then((res) => {
        if (res.status === 403) {
          setListError("You don't have access to view training requests.");
          setRows([]);
          setMeta(null);
          return null;
        }
        return res.json();
      })
      .then((json: { data: TrainingNeedRow[]; pagination?: ListMeta } | null) => {
        if (!json) return;
        setRows(json.data);
        setMeta(json.pagination ?? null);
        setListError(null);
      })
      .catch(() => setListError("Couldn't load training requests. Try again."));
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain, canViewAll, departmentFilter, priorityFilter, statusFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [departmentFilter, priorityFilter, statusFilter]);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteError(null);
    const res = await fetch(
      `${API_BASE}/training-needs/${deleteTarget.id}?subdomain=${encodeURIComponent(subdomain)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (res.ok) {
      setDeleteTarget(null);
      loadRows();
      return;
    }
    const json = (await res.json().catch(() => null)) as { message?: string } | null;
    setDeleteError(json?.message ?? "Couldn't delete this training request.");
  }

  const descriptionLine = canViewAll
    ? "Every submitted and approved training request across your organization."
    : "Training requests for your department.";

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader title="Training Requests" subtitle={descriptionLine} />
        {canManage && (
          <Button onClick={() => router.push("/learning/training-requests/new")}>
            <Plus className="h-4 w-4" />
            New training request
          </Button>
        )}
      </div>

      {listError && <div className="banner-error mt-4">{listError}</div>}

      {canViewAll && (
        <div className="mt-6 flex items-center gap-3">
          <select
            className="field-input max-w-xs"
            aria-label="Filter by department"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            className="field-input max-w-xs"
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <select
            className="field-input max-w-xs"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
          </select>
        </div>
      )}

      <Card className="mt-4 overflow-hidden p-0">
        {rows === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {canViewAll
              ? "No submitted training requests match your filters yet."
              : "No training requests yet — create your first one to get started."}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Title</th>
                {canViewAll && <th className="px-4 py-2 text-left font-medium text-slate-600">Department</th>}
                <th className="px-4 py-2 text-left font-medium text-slate-600">Priority</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                {canManage && <th className="px-4 py-2 text-right font-medium text-slate-600">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-border hover:bg-slate-50"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
                    router.push(`/learning/training-requests/${row.id}`);
                  }}
                >
                  <td className="px-4 py-3 text-sm text-primary">{row.title}</td>
                  {canViewAll && (
                    <td className="px-4 py-3 text-sm text-secondary">{row.departmentName ?? "—"}</td>
                  )}
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={PRIORITY_BADGE[row.priority]}>{PRIORITY_LABEL[row.priority]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={STATUS_BADGE_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          canDelete={canManageAll || row.status === "draft"}
                          onEdit={() => router.push(`/learning/training-requests/${row.id}/edit`)}
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

      {canViewAll && meta && meta.total > 0 && (
        <Pagination className="mt-3" page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />
      )}

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
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to delete this training request?</p>
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
            <Button onClick={handleDeleteConfirm}>Delete</Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
