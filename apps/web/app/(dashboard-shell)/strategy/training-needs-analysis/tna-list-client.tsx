"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ClipboardList, Calendar, Users, Search, ArrowRight, MoreHorizontal, CheckCircle2 } from "lucide-react";
import { PageHeader, Card, Badge, Button, Modal, Pagination, Toast, type ToastVariant } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";

const DISPLAY_PAGE_SIZE = 10;

type ExerciseStatus = "draft" | "active" | "closed" | "under_review" | "committed";

const STATUS_LABEL: Record<ExerciseStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  under_review: "Under Review",
  committed: "Committed",
};
const STATUS_BADGE: Record<ExerciseStatus, "neutral" | "warning" | "success" | "accent"> = {
  draft: "neutral",
  active: "accent",
  closed: "warning",
  under_review: "warning",
  committed: "success",
};

type StatusTab = "all" | "active" | "pending" | "completed" | "closed";

const STATUS_TABS: { key: StatusTab; label: string; matches: (status: ExerciseStatus) => boolean }[] = [
  { key: "all", label: "All", matches: () => true },
  { key: "active", label: "Active", matches: (s) => s === "active" },
  // "Pending" here means the exercise itself hasn't started yet — the admin lifecycle's `draft`
  // state — not to be confused with a participant's own `pending` (not-yet-submitted) assignment
  // status, which is a different concept on a different entity.
  { key: "pending", label: "Pending", matches: (s) => s === "draft" },
  { key: "completed", label: "Completed", matches: (s) => s === "under_review" || s === "committed" },
  { key: "closed", label: "Closed", matches: (s) => s === "closed" },
];

interface ExerciseRow {
  id: string;
  title: string;
  description: string | null;
  endDate: string;
  createdAt: string;
  status: ExerciseStatus;
  targetsAllDepartments: boolean;
  departmentNames: string[];
  createdByName: string | null;
  progress: { assigned: number; submitted: number; pending: number; completionPercent: number };
}

interface MyAssignmentRow {
  id: string;
  status: "pending" | "submitted";
  departmentName: string | null;
  exerciseId: string;
  exerciseTitle: string;
  exerciseStatus: ExerciseStatus;
  endDate: string;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(endDate: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / msPerDay);
}

/** The deadline "N days left" / "Overdue" pill — amber while there's still runway, red once past
 * due, matching the reference design's color language (amber = attention, not yet urgent). */
/** Red once overdue (or due today — no time left to act), amber inside a week (still doable but
 * needs attention soon), green otherwise (comfortable runway) — so urgency reads at a glance
 * across the whole table instead of every upcoming deadline looking the same. */
function DeadlineBadge({ endDate }: { endDate: string }) {
  const days = daysUntil(endDate);
  if (days < 0) return <Badge variant="danger">{Math.abs(days)} day{Math.abs(days) === 1 ? "" : "s"} overdue</Badge>;
  if (days === 0) return <Badge variant="danger">Due today</Badge>;
  if (days <= 7) {
    return (
      <Badge variant="warning">
        {days} day{days === 1 ? "" : "s"} left
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      {days} day{days === 1 ? "" : "s"} left
    </Badge>
  );
}

/** Ported verbatim from business-objectives-client.tsx's own `CircularProgress` — same shape (an
 * SVG ring rotated -90deg so the fill starts at 12 o'clock, a `stroke-slate-100` track circle behind
 * a `stroke-cta` progress circle whose `strokeDashoffset` encodes the percent) so Completion reads
 * identically across both tables rather than introducing a second progress-indicator convention. */
function CircularProgress({
  percent,
  size = 32,
  strokeWidth = 4,
  children,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-slate-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="stroke-cta transition-all"
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

interface RowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

const ROW_ACTIONS_MENU_WIDTH = 170;

/** Contextual row menu for one TNA exercise, mirroring the portal-based, click-outside-to-close
 * pattern already established for Department/Business Objective row menus — just parameterized by
 * a plain action list instead of fixed Edit/Archive/Delete slots, since which actions are valid
 * depends on the exercise's own 5-state lifecycle (draft/active/closed/under_review have entirely
 * different legal next actions; committed has none). */
function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuHeight = actions.length * 36 + 8;

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
      const top = spaceBelow < menuHeight ? rect.top - menuHeight : rect.bottom + 4;
      const left = rect.right - ROW_ACTIONS_MENU_WIDTH;
      setPosition({ top, left });
    }
    setOpen((prev) => !prev);
  }

  if (actions.length === 0) return null;

  return (
    <div data-row-actions>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Row actions"
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100 hover:text-primary"
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
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`block w-full cursor-pointer px-3 py-2 text-left text-sm ${
                  action.danger ? "text-red-600 hover:bg-red-50" : "text-secondary hover:bg-slate-50 hover:text-primary"
                }`}
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A prominent, actionable card for one of the current user's own assignments — "Action required"
 * (still pending) uses the gold/amber accent; a completed one below uses green instead, same shape.
 * Deliberately not the shared `Card`/`surface-card` styling (hairline border, no shadow, per the
 * Desktop Shell Visual Language spec) — this card needs a real drop shadow and a solid rounded
 * accent strip instead, so it's hand-built rather than fighting that shared component's own look.
 * Uses the subtle `shadow-card-sm` (not `-md`) so the drop shadow reads as a light lift, not a
 * heavy one. */
function MyAssignmentCard({ row, onOpen }: { row: MyAssignmentRow; onOpen: () => void }) {
  const isPending = row.status === "pending";
  return (
    <div className="flex overflow-hidden rounded-xl bg-white shadow-card-sm">
      <div className={`w-1.5 shrink-0 ${isPending ? "bg-amber-400" : "bg-green-400"}`} />
      <div className="flex flex-1 flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center flex-grow gap-4 ">
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${
              isPending ? "bg-amber-50 text-amber-500" : "bg-green-50 text-green-500"
            }`}
          >
            {isPending ? <ClipboardList className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
          </div>
          <div>
            <p className="text-lg font-bold text-primary capitalize">{row.exerciseTitle}</p>
            {row.departmentName && <p className="text-sm font-semibold text-secondary">{row.departmentName}</p>}
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
              <Users className="h-3.5 w-3.5" />
              Assigned to you
            </p>
          </div>
        </div>

        <div className="flex basis-3/5 items-center gap-8 sm:gap-14 ">
          <div className="flex items-center gap-6 sm:gap-8 mr-auto">
            <div className="hidden h-10 w-px bg-slate-200 sm:block" />

            <div className="flex items-start gap-2">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <p className="text-sm text-slate-500">Due</p>
                <p className="text-sm font-semibold text-primary">{formatDate(row.endDate)}</p>
              </div>
            </div>

            <div className="hidden h-10 w-px bg-slate-200 sm:block" />

            <div>
              <p className="text-sm text-slate-500">Status</p>
              <div className="mt-1.5">
                <Badge variant={isPending ? "warning" : "success"}>{isPending ? "Pending" : "Submitted"}</Badge>
              </div>
            </div>
          </div>

          <Button size="md" onClick={onOpen}>
            {isPending ? "Complete assessment" : "Manage responses"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const TRANSITION_SUCCESS_MESSAGE: Record<string, string> = {
  start: "TNA started — assignments created.",
  close: "TNA closed.",
  reopen: "TNA reopened.",
  archive: "TNA archived.",
  "begin-review": "TNA moved to review.",
  commit: "TNA committed.",
};

export default function TnaListClient({ subdomain, canManage, canView }: { subdomain: string; canManage: boolean; canView: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ExerciseRow | null>(null);
  const [commitTarget, setCommitTarget] = useState<ExerciseRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ExerciseRow | null>(null);

  // One-shot success toast after redirecting back from the full-screen create page
  // (tna-exercise-form.tsx), matching business-objectives-client.tsx's own pattern. Edits redirect
  // back to the detail page instead (there's no list-level "updated" case here).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("created") === "1") {
      setToast({ message: "TNA exercise created.", variant: "success" });
      router.replace("/strategy/training-needs-analysis");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exercisesQuery = useQuery({
    queryKey: ["tna-exercises", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: ExerciseRow[] }>("/tna-exercises", { subdomain });
      return data;
    },
    enabled: canView,
  });
  const exercises = useMemo(() => exercisesQuery.data ?? [], [exercisesQuery.data]);

  function invalidateExercises() {
    queryClient.invalidateQueries({ queryKey: ["tna-exercises", subdomain] });
  }

  const transitionMutation = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: Record<string, unknown> }) => {
      await tenantFetch(`/tna-exercises/${id}/${action}`, { method: "POST", subdomain, body });
    },
    onSuccess: (_data, variables) => {
      invalidateExercises();
      setToast({ message: TRANSITION_SUCCESS_MESSAGE[variables.action] ?? "TNA updated.", variant: "success" });
      setCommitTarget(null);
      setArchiveTarget(null);
    },
    onError: (err: Error) => setToast({ message: err.message, variant: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await tenantFetch(`/tna-exercises/${id}`, { method: "DELETE", subdomain });
    },
    onSuccess: () => {
      invalidateExercises();
      setToast({ message: "TNA exercise deleted.", variant: "success" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => setToast({ message: err.message, variant: "error" }),
  });

  /** Which row actions are legal depends entirely on the exercise's own status — committed is
   * terminal (no actions at all); every other state has a different, non-overlapping set. Commit
   * checks the row's own already-fetched `progress.pending` before deciding whether to go straight
   * through or ask for confirmation first, mirroring the detail page's own `handleCommitClick`. */
  function actionsForRow(row: ExerciseRow): RowAction[] {
    const goEdit = () => router.push(`/strategy/training-needs-analysis/${row.id}/edit`);
    if (row.status === "draft") {
      return [
        { label: "Edit", onClick: goEdit },
        { label: "Start", onClick: () => transitionMutation.mutate({ id: row.id, action: "start" }) },
        { label: "Delete", onClick: () => setDeleteTarget(row), danger: true },
      ];
    }
    if (row.status === "active") {
      return [
        { label: "Edit dates", onClick: goEdit },
        { label: "Close", onClick: () => transitionMutation.mutate({ id: row.id, action: "close" }) },
      ];
    }
    if (row.status === "closed") {
      return [
        { label: "Edit dates", onClick: goEdit },
        { label: "Reopen", onClick: () => transitionMutation.mutate({ id: row.id, action: "reopen" }) },
        { label: "Begin review", onClick: () => transitionMutation.mutate({ id: row.id, action: "begin-review" }) },
        { label: "Archive", onClick: () => setArchiveTarget(row) },
      ];
    }
    if (row.status === "under_review") {
      return [
        {
          label: "Commit",
          onClick: () =>
            row.progress.pending > 0
              ? setCommitTarget(row)
              : transitionMutation.mutate({ id: row.id, action: "commit" }),
        },
      ];
    }
    return [];
  }

  const myAssignmentsQuery = useQuery({
    queryKey: ["my-tna-assignments", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: MyAssignmentRow[] }>("/my-tna-assignments", { subdomain });
      return data;
    },
  });
  const myAssignments = myAssignmentsQuery.data ?? [];
  const pendingAssignments = myAssignments.filter((a) => a.status === "pending");
  const submittedAssignments = myAssignments.filter((a) => a.status === "submitted");

  const tabCounts = useMemo(
    () => Object.fromEntries(STATUS_TABS.map((tab) => [tab.key, exercises.filter((e) => tab.matches(e.status)).length])) as Record<StatusTab, number>,
    [exercises],
  );

  const departmentOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of exercises) for (const name of row.departmentNames) names.add(name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [exercises]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const row of exercises) years.add(row.endDate.slice(0, 4));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [exercises]);

  const filtered = useMemo(() => {
    const activeTab = STATUS_TABS.find((t) => t.key === statusTab)!;
    const q = search.trim().toLowerCase();
    return exercises.filter((row) => {
      if (!activeTab.matches(row.status)) return false;
      if (q && !row.title.toLowerCase().includes(q)) return false;
      if (departmentFilter && !row.targetsAllDepartments && !row.departmentNames.includes(departmentFilter)) return false;
      if (yearFilter && row.endDate.slice(0, 4) !== yearFilter) return false;
      return true;
    });
  }, [exercises, statusTab, search, departmentFilter, yearFilter]);

  useEffect(() => {
    setPage(1);
  }, [statusTab, search, departmentFilter, yearFilter]);

  const paged = filtered.slice((page - 1) * DISPLAY_PAGE_SIZE, page * DISPLAY_PAGE_SIZE);

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader title="Training Needs Analysis" subtitle="HR-initiated exercises to identify department training needs." />
        {canManage && (
          <Button onClick={() => router.push("/strategy/training-needs-analysis/new")}>
            <Plus className="h-4 w-4" />
            Create TNA
          </Button>
        )}
      </div>

      {pendingAssignments.length > 0 && (
        <div className="mt-8 mb-16">
          <h2 className="text-base font-semibold text-primary">Action required</h2>
          <p className="text-sm text-secondary">Complete your assigned assessment(s).</p>
          <div className="mt-6 space-y-3">
            {pendingAssignments.map((row) => (
              <MyAssignmentCard
                key={row.id}
                row={row}
                onOpen={() => router.push(`/strategy/training-needs-analysis/my/${row.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {submittedAssignments.length > 0 && (
        <div className="mt-6">
          <h2 className="text-base font-semibold text-primary">Completed by you</h2>
          <div className="mt-3 space-y-3">
            {submittedAssignments.map((row) => (
              <MyAssignmentCard
                key={row.id}
                row={row}
                onOpen={() => router.push(`/strategy/training-needs-analysis/my/${row.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {canView && (
        <div className="mt-8">
          <h2 className="text-base font-semibold text-primary">All Training Needs Analysis</h2>
          <p className="text-sm text-secondary">View and manage all TNAs across the organization.</p>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                className="field-input !pl-9"
                placeholder="Search TNA…"
                aria-label="Search TNA"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <select className="field-input max-w-xs" value={statusTab} onChange={(e) => setStatusTab(e.target.value as StatusTab)}>
                {STATUS_TABS.map((tab) => (
                  <option key={tab.key} value={tab.key}>
                    {tab.label} ({tabCounts[tab.key] ?? 0})
                  </option>
                ))}
              </select>
              <select className="field-input max-w-xs" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
                <option value="">Department</option>
                {departmentOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select className="field-input max-w-xs" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="">Year</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Card className="mt-4 overflow-hidden p-0">
            {exercisesQuery.isPending ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
            ) : exercises.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                {canManage ? "No TNA exercises yet — create your first one to get started." : "No TNA exercises yet."}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No TNA exercises match your filters.</div>
            ) : (
              <table className="w-full table-fixed divide-y divide-border text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[16%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold whitespace-nowrap text-slate-600">TNA</th>
                    <th className="px-4 py-2 text-left font-semibold whitespace-nowrap text-slate-600">Deadline</th>
                    <th className="px-4 py-2 text-left font-semibold whitespace-nowrap text-slate-600">Participants</th>
                    <th className="px-4 py-2 text-left font-semibold whitespace-nowrap text-slate-600">Completion</th>
                    <th className="px-4 py-2 text-left font-semibold whitespace-nowrap text-slate-600">Status</th>
                    <th className="px-4 py-2 text-right font-semibold whitespace-nowrap text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border hover:bg-slate-50"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
                        router.push(`/strategy/training-needs-analysis/${row.id}`);
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="truncate text-sm font-semibold text-primary capitalize" title={row.title}>
                          {row.title}
                        </div>
                        {row.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{row.description}</div>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-sm font-semibold text-secondary">{formatDate(row.endDate)}</p>
                        <div className="mt-1">
                          <DeadlineBadge endDate={row.endDate} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          {row.progress.submitted} / {row.progress.assigned}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <CircularProgress percent={row.progress.completionPercent} size={26} strokeWidth={3} />
                          <span className="text-xs text-secondary">{row.progress.completionPercent}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-sm">
                        <div className="flex justify-end">
                          <RowActionsMenu actions={canManage ? actionsForRow(row) : []} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {filtered.length > 10 && (
            <Pagination className="mt-3" page={page} pageSize={DISPLAY_PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
          )}
        </div>
      )}

      {!canView && myAssignments.length === 0 && !myAssignmentsQuery.isPending && (
        <div className="mt-8 p-8 text-center text-sm text-slate-500">
          You have no Training Needs Analysis exercises to view or complete.
        </div>
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={`Delete "${deleteTarget?.title ?? ""}"?`}>
        <div className="space-y-4">
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to delete this draft TNA exercise?</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              isLoading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!commitTarget} onClose={() => setCommitTarget(null)} title="Commit with pending responses?">
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            {commitTarget?.progress.pending} of {commitTarget?.progress.assigned} assignment(s) are still pending. Committing
            finalizes this TNA — pending assignments will never be submittable afterward. This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCommitTarget(null)}>
              Cancel
            </Button>
            <Button
              isLoading={transitionMutation.isPending}
              onClick={() =>
                commitTarget && transitionMutation.mutate({ id: commitTarget.id, action: "commit", body: { confirmDespitePending: true } })
              }
            >
              Commit anyway
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title={`Archive "${archiveTarget?.title ?? ""}"?`}>
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            It will be hidden from this list. Its responses and data aren&apos;t deleted, but there&apos;s no way to unarchive it
            from here.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button
              isLoading={transitionMutation.isPending}
              onClick={() => archiveTarget && transitionMutation.mutate({ id: archiveTarget.id, action: "archive" })}
            >
              Archive
            </Button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </main>
  );
}
