"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, User, CheckCircle2 } from "lucide-react";
import { Button, Modal, Toast, type ToastVariant } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import AudienceBuilderPanel from "./audience-builder-panel";
import type { CatalogEntry, SelectedGroup, SelectedUser } from "./audience-types";

type AudienceMode = "all" | "selected";

interface AssignmentResponse {
  mode: AudienceMode;
  /** Only meaningful when `mode === "all"`. */
  allStartsAt: string | null;
  allCompletionDeadline: string | null;
  users: SelectedUser[];
  departments: SelectedGroup[];
  roles: SelectedGroup[];
}

function formatDate(date: string | null, fallback: string): string {
  if (!date) return fallback;
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One of the two large mode-selection cards on the left — radio-button semantics (only one is ever
 * checked), but styled as a full card per the redesign rather than a bare `<input type="radio">`. */
function AudienceModeCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        selected ? "border-cta bg-cta/5" : "border-border hover:bg-slate-50"
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${selected ? "bg-cta/10 text-cta" : "bg-slate-100 text-secondary"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-primary">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{description}</span>
      </span>
      <span
        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-cta" : "border-slate-300"}`}
        aria-hidden="true"
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-cta" />}
      </span>
    </button>
  );
}

/** Right-panel content for "Everyone in this organization" — deliberately simple: no
 * users/departments/roles controls at all, just the two assignment-wide dates. `totalLearners` is
 * the live, deduped tenant user count from the audience-preview endpoint; `null` (still loading or
 * the request failed) just omits the count rather than showing a fabricated number. */
function EveryoneSummaryPanel({
  totalLearners,
  allStartsAt,
  onStartsAtChange,
  allCompletionDeadline,
  onCompletionDeadlineChange,
}: {
  totalLearners: number | null;
  allStartsAt: string | null;
  onStartsAtChange: (startsAt: string | null) => void;
  allCompletionDeadline: string | null;
  onCompletionDeadlineChange: (completionDeadline: string | null) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-6">
      <p className="text-base font-semibold text-primary">Everyone in the organization</p>
      <p className="mt-1 text-sm text-muted">This course will be available to all learners in your organization.</p>

      <div className="mt-6 flex flex-col gap-6">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-secondary uppercase">Audience</p>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-cta" />
            <span className="text-sm font-medium text-primary">All learners {totalLearners !== null ? `(${totalLearners.toLocaleString()})` : ""}</span>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-secondary uppercase">Access</p>
          <ul className="space-y-1.5">
            <li className="flex items-center gap-2 text-sm text-secondary">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              Visible in their course catalog
            </li>
            <li className="flex items-center gap-2 text-sm text-secondary">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              No department or role restrictions
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-6">
        <div className="max-w-xs">
          <label className="field-label" htmlFor="all-starts-at">
            Access starts <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="all-starts-at"
            type="date"
            className="field-input h-10 text-sm"
            value={allStartsAt ?? ""}
            onChange={(e) => onStartsAtChange(e.target.value || null)}
          />
        </div>
        <div className="max-w-xs">
          <label className="field-label" htmlFor="all-completion-deadline">
            Course completion deadline <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="all-completion-deadline"
            type="date"
            className="field-input h-10 text-sm"
            value={allCompletionDeadline ?? ""}
            onChange={(e) => onCompletionDeadlineChange(e.target.value || null)}
          />
        </div>
      </div>
    </div>
  );
}

/** Read-only rendering (`course.view` without `course.manage`) — no controls, just the resolved
 * state, reusing the same visual language as the editable views. */
function ReadOnlyAudience({ data, totalLearners }: { data: AssignmentResponse; totalLearners: number | null }) {
  if (data.mode === "all") {
    return (
      <div className="rounded-lg border border-border bg-white p-6">
        <p className="text-base font-semibold text-primary">Everyone in the organization</p>
        <p className="mt-1 text-sm text-muted">
          All learners {totalLearners !== null ? `(${totalLearners.toLocaleString()})` : ""} can see and access this course.
        </p>
        <p className="mt-2 text-sm text-secondary">
          {formatDate(data.allStartsAt, "Available immediately")} · {formatDate(data.allCompletionDeadline, "No due date")}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {([
        ["Users", data.users.map((u) => ({ id: u.id, label: `${u.fullName} (${u.email})`, startsAt: u.startsAt, completionDeadline: u.completionDeadline }))],
        ["Departments", data.departments.map((d) => ({ id: d.id, label: d.name, startsAt: d.startsAt, completionDeadline: d.completionDeadline }))],
        ["Roles", data.roles.map((r) => ({ id: r.id, label: r.name, startsAt: r.startsAt, completionDeadline: r.completionDeadline }))],
      ] as const).map(([label, rows]) => (
        <div key={label} className="rounded-lg border border-border bg-white p-4">
          <p className="field-label">{label}</p>
          {rows.length === 0 ? (
            <p className="text-sm italic text-slate-400">None</p>
          ) : (
            <ul className="space-y-1">
              {rows.map((row) => (
                <li key={row.id} className="text-sm text-secondary">
                  {row.label} — {formatDate(row.startsAt, "Starts immediately")} · {formatDate(row.completionDeadline, "No due date")}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The Settings top-tab: an "Audience Builder" for who this course is assigned to — Everyone in the
 * tenant, or a union of specific users/departments/roles, each with its own optional "access starts"
 * and "deadline" dates (Course Assignment Settings + Deadlines). Assignment is enforcement, not just
 * metadata: the course list/detail routes hide a course from any learner outside its assigned
 * audience, so this panel is the only place that audience is configured.
 *
 * No Cancel/Save here — every change (mode, dates, or the user/department/role selection) autosaves
 * itself a short debounce after the last edit, the same "no separate save step" convention as the
 * rest of this course editor (Course Details' image upload, the lesson-form autosave hook). There's
 * nothing to "Cancel" back to as a result; the confirmation modal below (switching to "Everyone")
 * still exists because that one action is destructive (replaces the specific-audience configuration
 * outright), not because of any pending unsaved state.
 *
 * Local state (`mode`/`allStartsAt`/`allCompletionDeadline`/`selectedUsers`/`selectedDepartments`/
 * `selectedRoles`) is never destroyed just by toggling between the two mode cards — switching to
 * "Everyone" only *hides* the specific-audience builder, it doesn't clear it, so switching back
 * always restores exactly what was there.
 */
export default function SettingsTab({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();

  const assignmentQuery = useQuery({
    queryKey: ["course-assignments", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: AssignmentResponse }>(`/courses/${courseId}/assignments`, { subdomain });
      return data;
    },
  });
  const departmentsQuery = useQuery({
    queryKey: ["departments", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CatalogEntry[] }>("/departments", { subdomain });
      return data;
    },
    enabled: !readOnly,
  });
  const rolesQuery = useQuery({
    queryKey: ["roles", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CatalogEntry[] }>("/roles", { subdomain });
      return data;
    },
    enabled: !readOnly,
  });

  const [mode, setMode] = useState<AudienceMode>("all");
  const [allStartsAt, setAllStartsAt] = useState<string | null>(null);
  const [allCompletionDeadline, setAllCompletionDeadline] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<SelectedUser[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<SelectedGroup[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<SelectedGroup[]>([]);
  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [saving, setSaving] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The state snapshot autosave last saw — `null` until the very first sync from the server, so that
  // initial sync itself is never mistaken for an admin edit and doesn't fire a save.
  const lastSeenSignatureRef = useRef<string | null>(null);

  // Syncs local form state from the server exactly once, the first time it loads — never again on a
  // later background refetch (e.g. the one this same save triggers), so a save can't clobber
  // whatever the admin is mid-editing.
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (hasSyncedRef.current || !assignmentQuery.data) return;
    hasSyncedRef.current = true;
    const data = assignmentQuery.data;
    setMode(data.mode);
    setAllStartsAt(data.allStartsAt);
    setAllCompletionDeadline(data.allCompletionDeadline);
    setSelectedUsers(data.users);
    setSelectedDepartments(data.departments);
    setSelectedRoles(data.roles);
  }, [assignmentQuery.data]);

  const hasSpecificSelection = selectedUsers.length > 0 || selectedDepartments.length > 0 || selectedRoles.length > 0;

  function handleSelectAll() {
    if (mode === "all") return;
    if (hasSpecificSelection) {
      setConfirmSwitchOpen(true);
      return;
    }
    setMode("all");
  }

  function handleSelectSpecific() {
    setMode("selected");
  }

  // Debounced, deduplicated learner-count preview — keyed off id sets only (not the full selection
  // objects, which also carry each target's own dates) so editing a date field never triggers a
  // redundant re-count; only actually adding/removing a user/department/role does.
  const userIdsKey = useMemo(() => selectedUsers.map((u) => u.id).sort().join(","), [selectedUsers]);
  const departmentIdsKey = useMemo(() => selectedDepartments.map((d) => d.id).sort().join(","), [selectedDepartments]);
  const roleIdsKey = useMemo(() => selectedRoles.map((r) => r.id).sort().join(","), [selectedRoles]);
  const [totalLearners, setTotalLearners] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    // A read-only (`course.view`-only) caller can't call the preview endpoint at all (403,
    // `course.manage`-gated) — skip it entirely rather than firing a request guaranteed to fail.
    if (readOnly) return;
    if (mode === "selected" && !userIdsKey && !departmentIdsKey && !roleIdsKey) {
      setTotalLearners(0);
      return;
    }
    setPreviewLoading(true);
    const handle = setTimeout(async () => {
      try {
        const body =
          mode === "all"
            ? { mode: "all" as const }
            : {
                mode: "selected" as const,
                userIds: userIdsKey ? userIdsKey.split(",") : [],
                departmentIds: departmentIdsKey ? departmentIdsKey.split(",") : [],
                roleIds: roleIdsKey ? roleIdsKey.split(",") : [],
              };
        const { data } = await tenantFetch<{ data: { totalLearners: number } }>("/course-assignments/audience-preview", {
          method: "POST",
          subdomain,
          body,
        });
        setTotalLearners(data.totalLearners);
      } catch {
        setTotalLearners(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [mode, userIdsKey, departmentIdsKey, roleIdsKey, subdomain, readOnly]);

  const canSave = mode === "all" || hasSpecificSelection;

  function summaryText(): string {
    if (mode === "all") {
      return totalLearners !== null ? `Everyone in this organization · ${totalLearners.toLocaleString()} learners` : "Everyone in this organization";
    }
    if (!hasSpecificSelection) return "No audience selected yet";
    const parts: string[] = [];
    if (selectedDepartments.length > 0) parts.push(`${selectedDepartments.length} department${selectedDepartments.length === 1 ? "" : "s"}`);
    if (selectedUsers.length > 0) parts.push(`${selectedUsers.length} user${selectedUsers.length === 1 ? "" : "s"}`);
    if (selectedRoles.length > 0) parts.push(`${selectedRoles.length} role${selectedRoles.length === 1 ? "" : "s"}`);
    const base = parts.join(" · ");
    return totalLearners !== null ? `${base} · ${totalLearners.toLocaleString()} learners` : base;
  }

  async function performSave() {
    setSaving(true);
    try {
      await tenantFetch(`/courses/${courseId}/assignments`, {
        method: "PUT",
        subdomain,
        body: {
          mode,
          allStartsAt: mode === "all" ? allStartsAt : null,
          allCompletionDeadline: mode === "all" ? allCompletionDeadline : null,
          users: selectedUsers.map((u) => ({ id: u.id, startsAt: u.startsAt, completionDeadline: u.completionDeadline })),
          departments: selectedDepartments.map((d) => ({ id: d.id, startsAt: d.startsAt, completionDeadline: d.completionDeadline })),
          roles: selectedRoles.map((r) => ({ id: r.id, startsAt: r.startsAt, completionDeadline: r.completionDeadline })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["course-assignments", courseId, subdomain] });
      setAutosaveStatus("saved");
    } catch (err) {
      setToast({ message: (err as Error).message, variant: "error" });
      setAutosaveStatus("idle");
    } finally {
      setSaving(false);
    }
  }

  // Debounced autosave — any real change to mode/dates/selection (detected via a plain JSON
  // signature, simplest way to catch a per-item date edit buried inside `selectedUsers` etc. without
  // hand-rolling deep-equality) schedules a save shortly after the last edit, same "no separate save
  // step" convention the rest of this course editor already uses. Skips both the initial sync from
  // the server (not an edit) and an incomplete "Specific people, nothing picked yet" state (mirrors
  // `!canSave`'s old validation, just silent instead of a toast — there's no explicit Save click left
  // to react to).
  const stateSignature = JSON.stringify({ mode, allStartsAt, allCompletionDeadline, selectedUsers, selectedDepartments, selectedRoles });
  useEffect(() => {
    // No controls render in the read-only branch below, so state can never actually change there —
    // guarded explicitly anyway so autosave can never fire for a view-only (`course.view`-only)
    // caller even if that assumption ever stops holding.
    if (readOnly) return;
    if (!hasSyncedRef.current) return;
    if (lastSeenSignatureRef.current === null) {
      lastSeenSignatureRef.current = stateSignature;
      return;
    }
    if (lastSeenSignatureRef.current === stateSignature) return;
    lastSeenSignatureRef.current = stateSignature;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (!canSave) return;
    setAutosaveStatus("saving");
    saveTimeoutRef.current = setTimeout(() => {
      void performSave();
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateSignature, canSave, readOnly]);

  if (!assignmentQuery.data) {
    return assignmentQuery.isError ? (
      <p className="banner-error">Couldn&apos;t load this course&apos;s assignment. Try refreshing.</p>
    ) : (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  if (readOnly) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-primary">Choose who this course is assigned to</h2>
        <p className="mb-6 text-sm text-muted">Learners outside this audience won&apos;t see it in their course catalog.</p>
        <ReadOnlyAudience data={assignmentQuery.data} totalLearners={totalLearners} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-primary">Choose who this course is assigned to</h2>
          <p className="text-sm text-muted">Learners outside this audience won&apos;t see it in their course catalog.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          {autosaveStatus === "saving" ? (
            <>
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
              <span>Saving…</span>
            </>
          ) : (
            autosaveStatus === "saved" && <span>Saved</span>
          )}
        </div>
      </div>

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex w-full flex-col gap-3 lg:w-72 lg:shrink-0" role="radiogroup" aria-label="Audience mode">
          <AudienceModeCard
            icon={Users}
            title="Everyone in this organization"
            description="Every learner in the tenant can see and access this course."
            selected={mode === "all"}
            onClick={handleSelectAll}
            disabled={saving}
          />
          <AudienceModeCard
            icon={User}
            title="Specific people"
            description="Choose exactly which users, departments, or roles it's assigned to."
            selected={mode === "selected"}
            onClick={handleSelectSpecific}
            disabled={saving}
          />
        </div>

        <div className="min-w-0 flex-1">
          {mode === "all" ? (
            <EveryoneSummaryPanel
              totalLearners={totalLearners}
              allStartsAt={allStartsAt}
              onStartsAtChange={setAllStartsAt}
              allCompletionDeadline={allCompletionDeadline}
              onCompletionDeadlineChange={setAllCompletionDeadline}
            />
          ) : (
            <div className="rounded-lg border border-border bg-white p-6">
              <div className="mb-4">
                <p className="text-xs font-semibold tracking-wide text-secondary uppercase">Audience</p>
                <p className="mt-0.5 text-sm text-primary">{previewLoading ? "Calculating…" : summaryText()}</p>
              </div>
              <AudienceBuilderPanel
                subdomain={subdomain}
                selectedUsers={selectedUsers}
                onUsersChange={setSelectedUsers}
                departments={departmentsQuery.data ?? []}
                departmentsLoading={departmentsQuery.isLoading}
                departmentsError={departmentsQuery.isError}
                onRetryDepartments={() => departmentsQuery.refetch()}
                selectedDepartments={selectedDepartments}
                onDepartmentsChange={setSelectedDepartments}
                roles={rolesQuery.data ?? []}
                rolesLoading={rolesQuery.isLoading}
                rolesError={rolesQuery.isError}
                onRetryRoles={() => rolesQuery.refetch()}
                selectedRoles={selectedRoles}
                onRolesChange={setSelectedRoles}
              />
            </div>
          )}
        </div>
      </div>

      <Modal open={confirmSwitchOpen} onClose={() => setConfirmSwitchOpen(false)} title="Switch to Everyone in this organization?">
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Switching to Everyone in this organization will replace your current specific audience configuration.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmSwitchOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setMode("all");
                setConfirmSwitchOpen(false);
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
