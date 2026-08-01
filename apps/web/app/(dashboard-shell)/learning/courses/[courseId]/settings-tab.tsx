"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Badge, Toast, type ToastVariant } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";

interface UserTarget {
  id: string;
  fullName: string;
  email: string;
}

interface NamedTarget {
  id: string;
  name: string;
}

type AssignmentMode = "all" | "selected";

interface AssignmentResponse {
  mode: AssignmentMode;
  users: UserTarget[];
  departments: NamedTarget[];
  roles: NamedTarget[];
}

/** Multi-select user search — the same debounced `/users?search=` lookup and bordered-row visual
 * `department-settings-client.tsx`'s `PersonPicker` uses, extended to hold many selections instead
 * of one: each pick renders as its own removable row rather than collapsing to a single value, and
 * the dropdown excludes whoever's already selected. */
function MultiUserPicker({
  subdomain,
  selected,
  onChange,
}: {
  subdomain: string;
  selected: UserTarget[];
  onChange: (next: UserTarget[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserTarget[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const { data } = await tenantFetch<{ data: UserTarget[] }>(`/users?search=${encodeURIComponent(query)}`, { subdomain });
      setResults(data.filter((u) => !selected.some((s) => s.id === u.id)));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, subdomain, selected]);

  return (
    <div>
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {selected.map((u) => (
            <li key={u.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm text-primary">
                {u.fullName} <span className="text-slate-400">({u.email})</span>
              </span>
              <button
                type="button"
                className="cursor-pointer text-xs font-medium text-slate-500 hover:text-primary"
                onClick={() => onChange(selected.filter((s) => s.id !== u.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input
          className="field-input"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-white py-1 shadow-card-md">
            {results.map((u) => (
              <button
                key={u.id}
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50"
                onClick={() => {
                  onChange([...selected, u]);
                  setQuery("");
                  setResults([]);
                }}
              >
                {u.fullName} <span className="text-slate-400">({u.email})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A flat, client-filterable checkbox list with a "select all" master checkbox — the same shape
 * `roles-settings-client.tsx` uses per permission-category group, applied here to a flat
 * department/role list instead of a grouped catalog. */
function CheckboxList({
  searchLabel,
  items,
  selectedIds,
  onChange,
  emptyMessage,
}: {
  searchLabel: string;
  items: NamedTarget[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  emptyMessage: string;
}) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () => items.filter((i) => i.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [items, filter],
  );
  const allChecked = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleAll() {
    const next = new Set(selectedIds);
    for (const item of filtered) {
      if (allChecked) next.delete(item.id);
      else next.add(item.id);
    }
    onChange(next);
  }

  if (items.length === 0) {
    return <p className="text-sm italic text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <input
          className="field-input h-8 flex-1 py-1 text-sm"
          placeholder={`Search ${searchLabel}…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-secondary">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          Select all
        </label>
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto px-3 py-2">
        {filtered.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">No matches.</p>
        ) : (
          filtered.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggle(item.id)} />
              <span className="text-sm text-primary">{item.name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/** Read-only rendering of the current assignment — used for anyone without `course.manage`.
 * Renders directly from the assignment response's own resolved names rather than cross-referencing
 * the org-wide department/role catalogs (which a read-only viewer may not even be allowed to list),
 * so it's correct even when nothing else on the page could show those catalogs. */
function ReadOnlyAssignment({ data }: { data: AssignmentResponse }) {
  if (data.mode === "all") {
    return <p className="text-sm text-secondary">Everyone in this organization can see and access this course.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="field-label">Users</p>
        {data.users.length === 0 ? (
          <p className="text-sm italic text-slate-400">None</p>
        ) : (
          <ul className="space-y-1">
            {data.users.map((u) => (
              <li key={u.id} className="text-sm text-secondary">
                {u.fullName} <span className="text-slate-400">({u.email})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="field-label">Departments</p>
        {data.departments.length === 0 ? (
          <p className="text-sm italic text-slate-400">None</p>
        ) : (
          <ul className="space-y-1">
            {data.departments.map((d) => (
              <li key={d.id} className="text-sm text-secondary">
                {d.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="field-label">Roles</p>
        {data.roles.length === 0 ? (
          <p className="text-sm italic text-slate-400">None</p>
        ) : (
          <ul className="space-y-1">
            {data.roles.map((r) => (
              <li key={r.id} className="text-sm text-secondary">
                {r.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The Settings top-tab: who this course is assigned to — Everyone in the tenant, or specific
 * users/departments/roles (Course Assignment Settings). Assignment is enforcement, not just
 * metadata: the course list/detail routes hide a course from any learner (anyone without
 * `course.manage`) outside its assigned audience, so this panel is the only place that audience is
 * configured. Independent "Save Changes", matching every other Information-tab panel's own
 * self-contained save.
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
  // Only fetched for an editor (`course.manage`) — a read-only viewer renders straight from
  // `assignmentQuery.data`'s own resolved names instead (see `ReadOnlyAssignment` below), so this
  // never needs to run for them. That matters beyond just avoiding a wasted request: a read-only
  // viewer (e.g. a Manager with only `course.view`) may well lack `department.view`/`roles.read`
  // themselves, and a failed catalog fetch must never be mistaken for "nothing is assigned".
  const departmentsQuery = useQuery({
    queryKey: ["departments", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: NamedTarget[] }>("/departments", { subdomain });
      return data;
    },
    enabled: !readOnly,
  });
  const rolesQuery = useQuery({
    queryKey: ["roles", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: NamedTarget[] }>("/roles", { subdomain });
      return data;
    },
    enabled: !readOnly,
  });

  const [mode, setMode] = useState<AssignmentMode>("all");
  const [selectedUsers, setSelectedUsers] = useState<UserTarget[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<Set<string>>(new Set());
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [saving, setSaving] = useState(false);

  // Syncs local form state from the server exactly once, the first time it loads — never again on
  // a later background refetch (e.g. the one this same save triggers), so a save can't clobber
  // whatever the admin is mid-editing. Unlike the sibling panels' own `[course?.id]` trick (there's
  // no natural "id" to key off here besides `courseId`, which never changes for a mounted tab), a
  // ref guard expresses the same "sync once" intent directly.
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (hasSyncedRef.current || !assignmentQuery.data) return;
    hasSyncedRef.current = true;
    const data = assignmentQuery.data;
    setMode(data.mode);
    setSelectedUsers(data.users);
    setSelectedDepartmentIds(new Set(data.departments.map((d) => d.id)));
    setSelectedRoleIds(new Set(data.roles.map((r) => r.id)));
  }, [assignmentQuery.data]);

  const hasAnyTarget = selectedUsers.length > 0 || selectedDepartmentIds.size > 0 || selectedRoleIds.size > 0;
  const canSave = mode === "all" || hasAnyTarget;

  async function handleSave() {
    if (!canSave) {
      setToast({ message: "Select at least one user, department, or role, or choose Everyone.", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      await tenantFetch(`/courses/${courseId}/assignments`, {
        method: "PUT",
        subdomain,
        body: {
          mode,
          userIds: selectedUsers.map((u) => u.id),
          departmentIds: Array.from(selectedDepartmentIds),
          roleIds: Array.from(selectedRoleIds),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["course-assignments", courseId, subdomain] });
      setToast({ message: "Course settings saved.", variant: "success" });
    } catch (err) {
      setToast({ message: (err as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (!assignmentQuery.data) {
    return assignmentQuery.isError ? (
      <p className="banner-error">Couldn&apos;t load this course&apos;s assignment. Try refreshing.</p>
    ) : (
      <p className="text-sm text-muted">Loading…</p>
    );
  }

  if (readOnly) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-primary">Course Assignment</h2>
        <p className="mb-6 text-sm text-muted">Who this course is assigned to.</p>
        <ReadOnlyAssignment data={assignmentQuery.data} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">Course Assignment</h2>
      <p className="mb-6 text-sm text-muted">
        Choose who this course is assigned to. Learners outside this audience won&apos;t see it in their course catalog.
      </p>

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}

      <fieldset className="flex flex-col gap-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("all")}
            className={`cursor-pointer rounded-lg border px-4 py-3 text-left transition-colors ${
              mode === "all" ? "border-accent bg-slate-50" : "border-border hover:bg-slate-50"
            }`}
          >
            <span className="block text-sm font-semibold text-primary">Everyone in this organization</span>
            <span className="block text-xs text-muted">Every learner in the tenant can see and access this course.</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("selected")}
            className={`cursor-pointer rounded-lg border px-4 py-3 text-left transition-colors ${
              mode === "selected" ? "border-accent bg-slate-50" : "border-border hover:bg-slate-50"
            }`}
          >
            <span className="block text-sm font-semibold text-primary">Specific people</span>
            <span className="block text-xs text-muted">Choose exactly which users, departments, or roles it&apos;s assigned to.</span>
          </button>
        </div>

        {mode === "selected" && (
          <div className="flex flex-col gap-6">
            {!hasAnyTarget && (
              <p className="text-sm text-amber-600">Select at least one user, department, or role below.</p>
            )}

            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <p className="field-label mb-0">Users</p>
                {selectedUsers.length > 0 && <Badge variant="accent">{selectedUsers.length} selected</Badge>}
              </div>
              <MultiUserPicker subdomain={subdomain} selected={selectedUsers} onChange={setSelectedUsers} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <p className="field-label mb-0">Departments</p>
                {selectedDepartmentIds.size > 0 && <Badge variant="accent">{selectedDepartmentIds.size} selected</Badge>}
              </div>
              <CheckboxList
                searchLabel="departments"
                items={departmentsQuery.data ?? []}
                selectedIds={selectedDepartmentIds}
                onChange={setSelectedDepartmentIds}
                emptyMessage="No departments yet — create one under Settings > Departments."
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <p className="field-label mb-0">Roles</p>
                {selectedRoleIds.size > 0 && <Badge variant="accent">{selectedRoleIds.size} selected</Badge>}
              </div>
              <CheckboxList
                searchLabel="roles"
                items={rolesQuery.data ?? []}
                selectedIds={selectedRoleIds}
                onChange={setSelectedRoleIds}
                emptyMessage="No roles yet — create one under Settings > Roles."
              />
            </div>
          </div>
        )}
      </fieldset>

      <div className="mt-6">
        <Button onClick={handleSave} variant="secondary" isLoading={saving}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
