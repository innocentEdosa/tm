"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronDown, ChevronRight, Building2, Shield, X } from "lucide-react";
import { Badge, Pagination } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import type { CatalogEntry, SelectedGroup, SelectedUser, UserSearchResult } from "./audience-types";

const USERS_PAGE_SIZE = 8;

/** A department/role picker: search + "select all" header, then a flat list of rows — each with a
 * checkbox, name, member-count badge, and (once selected) an expand chevron. The "access starts"
 * date field is never permanently visible — it only appears once a row is both selected *and*
 * expanded, closing the main complaint about the old UI (a date input under every single row all
 * the time). Selecting a row auto-expands it (you almost always want to see the date field right
 * after selecting); the chevron otherwise just collapses/reopens it. Shared by both the Departments
 * and Roles tabs — they're structurally identical, just a different catalog/icon/copy. */
function GroupPickerList({
  items,
  loading,
  error,
  onRetry,
  selected,
  onChange,
  searchPlaceholder,
  emptyMessage,
  icon: Icon,
  noun,
}: {
  items: CatalogEntry[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selected: SelectedGroup[];
  onChange: (next: SelectedGroup[]) => void;
  searchPlaceholder: string;
  emptyMessage: string;
  icon: React.ComponentType<{ className?: string }>;
  noun: string;
}) {
  const [filter, setFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(filter.trim().toLowerCase())), [items, filter]);
  const selectedById = useMemo(() => new Map(selected.map((s) => [s.id, s])), [selected]);
  const allChecked = filtered.length > 0 && filtered.every((i) => selectedById.has(i.id));

  function toggle(item: CatalogEntry) {
    if (selectedById.has(item.id)) {
      onChange(selected.filter((s) => s.id !== item.id));
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } else {
      onChange([...selected, { id: item.id, name: item.name, startsAt: null, completionDeadline: null }]);
      setExpandedIds((prev) => new Set(prev).add(item.id));
    }
  }

  function toggleAll() {
    if (allChecked) {
      const ids = new Set(filtered.map((i) => i.id));
      onChange(selected.filter((s) => !ids.has(s.id)));
    } else {
      const additions = filtered
        .filter((i) => !selectedById.has(i.id))
        .map((i) => ({ id: i.id, name: i.name, startsAt: null, completionDeadline: null }));
      onChange([...selected, ...additions]);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setStartsAt(id: string, startsAt: string) {
    onChange(selected.map((s) => (s.id === id ? { ...s, startsAt: startsAt || null } : s)));
  }

  function setCompletionDeadline(id: string, completionDeadline: string) {
    onChange(selected.map((s) => (s.id === id ? { ...s, completionDeadline: completionDeadline || null } : s)));
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field-input h-10 !pl-9 text-sm" placeholder={searchPlaceholder} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-secondary">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={filtered.length === 0} />
          Select all
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-red-600">
          Couldn&apos;t load {noun}s.{" "}
          <button type="button" className="cursor-pointer font-medium underline" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">{emptyMessage}</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">No {noun}s found.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {filtered.map((item) => {
            const target = selectedById.get(item.id);
            const isSelected = !!target;
            const isExpanded = isSelected && expandedIds.has(item.id);
            return (
              <li key={item.id} className={isSelected ? "bg-cta/5" : "bg-white"}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(item)} aria-label={`Select ${item.name}`} />
                    <Icon className="h-4 w-4 shrink-0 text-secondary" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{item.name}</span>
                  </label>
                  <Badge variant="neutral">
                    {item.memberCount} {item.memberCount === 1 ? "user" : "users"}
                  </Badge>
                  {isSelected ? (
                    <button
                      type="button"
                      aria-label={isExpanded ? `Collapse ${item.name}` : `Expand ${item.name}`}
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(item.id)}
                      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-secondary hover:bg-slate-100"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                  )}
                </div>
                {isExpanded && (
                  <div className="flex flex-wrap gap-6 border-t border-border bg-white px-4 py-3 pl-11">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-secondary" htmlFor={`access-start-${item.id}`}>
                        Access starts
                      </label>
                      <input
                        id={`access-start-${item.id}`}
                        type="date"
                        className="field-input h-9 max-w-[200px] py-1.5 text-sm"
                        value={target?.startsAt ?? ""}
                        onChange={(e) => setStartsAt(item.id, e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-secondary" htmlFor={`completion-deadline-${item.id}`}>
                        Course completion deadline
                      </label>
                      <input
                        id={`completion-deadline-${item.id}`}
                        type="date"
                        className="field-input h-9 max-w-[200px] py-1.5 text-sm"
                        value={target?.completionDeadline ?? ""}
                        onChange={(e) => setCompletionDeadline(item.id, e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The Users tab: search-and-browse (paginated, server-side — scales to large tenants) plus a
 * separate "selected" list underneath giving each individually-picked user the same
 * expand-for-a-date-field treatment as a department/role row. The two lists are deliberately
 * different in shape: browsing hundreds of users with a date field under every row would be
 * clutter; only the (usually short) selected subset needs one. */
function UsersPickerList({ subdomain, selected, onChange }: { subdomain: string; selected: SelectedUser[]; onChange: (next: SelectedUser[]) => void }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const usersQuery = useQuery({
    queryKey: ["audience-users-browse", subdomain, debouncedSearch, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(USERS_PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return tenantFetch<{ data: UserSearchResult[]; pagination: { page: number; pageSize: number; total: number } }>(`/users?${params.toString()}`, {
        subdomain,
      });
    },
  });

  const selectedById = useMemo(() => new Map(selected.map((s) => [s.id, s])), [selected]);

  function toggle(u: UserSearchResult) {
    if (selectedById.has(u.id)) {
      onChange(selected.filter((s) => s.id !== u.id));
    } else {
      onChange([...selected, { ...u, startsAt: null, completionDeadline: null }]);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setStartsAt(id: string, startsAt: string) {
    onChange(selected.map((s) => (s.id === id ? { ...s, startsAt: startsAt || null } : s)));
  }

  function setCompletionDeadline(id: string, completionDeadline: string) {
    onChange(selected.map((s) => (s.id === id ? { ...s, completionDeadline: completionDeadline || null } : s)));
  }

  const rows = usersQuery.data?.data ?? [];
  const pagination = usersQuery.data?.pagination;

  return (
    <div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <input className="field-input h-10 !pl-9 text-sm" placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {usersQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : usersQuery.isError ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-red-600">
          Couldn&apos;t load users.{" "}
          <button type="button" className="cursor-pointer font-medium underline" onClick={() => usersQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">No users found.</p>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rows.map((u) => {
              const isSelected = selectedById.has(u.id);
              return (
                <li key={u.id}>
                  <label className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${isSelected ? "bg-cta/5" : ""}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(u)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-primary">{u.fullName}</span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {pagination && pagination.total > USERS_PAGE_SIZE && (
            <Pagination className="mt-3" page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />
          )}
        </>
      )}

      {selected.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold tracking-wide text-secondary uppercase">
            {selected.length} selected
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {selected.map((u) => {
              const isExpanded = expandedIds.has(u.id);
              return (
                <li key={u.id} className="bg-cta/5">
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Decorative only ("this row is selected") — the X button below is the one and
                       only way to remove a row here, so this doesn't also need its own click handler
                       duplicating that action. */}
                    <input type="checkbox" checked disabled aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-primary">{u.fullName}</span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={isExpanded ? `Collapse ${u.fullName}` : `Expand ${u.fullName}`}
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(u.id)}
                      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-secondary hover:bg-slate-100"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${u.fullName}`}
                      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-secondary hover:bg-slate-100"
                      onClick={() => onChange(selected.filter((s) => s.id !== u.id))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="flex flex-wrap gap-6 border-t border-border bg-white px-4 py-3 pl-11">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-secondary" htmlFor={`access-start-user-${u.id}`}>
                          Access starts
                        </label>
                        <input
                          id={`access-start-user-${u.id}`}
                          type="date"
                          className="field-input h-9 max-w-[200px] py-1.5 text-sm"
                          value={u.startsAt ?? ""}
                          onChange={(e) => setStartsAt(u.id, e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-secondary" htmlFor={`completion-deadline-user-${u.id}`}>
                          Course completion deadline
                        </label>
                        <input
                          id={`completion-deadline-user-${u.id}`}
                          type="date"
                          className="field-input h-9 max-w-[200px] py-1.5 text-sm"
                          value={u.completionDeadline ?? ""}
                          onChange={(e) => setCompletionDeadline(u.id, e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

type AudienceTab = "users" | "departments" | "roles";

/**
 * The "Specific people" audience builder — tab nav (Users/Departments/Roles) over three selection
 * lists, all lifted to the parent (`settings-tab.tsx`) so switching tabs, searching, or paginating
 * never loses a selection. Only one tab's controls are ever visible at a time, per the redesign's
 * core complaint about the old UI showing three full pickers stacked on the page at once.
 */
export default function AudienceBuilderPanel({
  subdomain,
  selectedUsers,
  onUsersChange,
  departments,
  departmentsLoading,
  departmentsError,
  onRetryDepartments,
  selectedDepartments,
  onDepartmentsChange,
  roles,
  rolesLoading,
  rolesError,
  onRetryRoles,
  selectedRoles,
  onRolesChange,
}: {
  subdomain: string;
  selectedUsers: SelectedUser[];
  onUsersChange: (next: SelectedUser[]) => void;
  departments: CatalogEntry[];
  departmentsLoading: boolean;
  departmentsError: boolean;
  onRetryDepartments: () => void;
  selectedDepartments: SelectedGroup[];
  onDepartmentsChange: (next: SelectedGroup[]) => void;
  roles: CatalogEntry[];
  rolesLoading: boolean;
  rolesError: boolean;
  onRetryRoles: () => void;
  selectedRoles: SelectedGroup[];
  onRolesChange: (next: SelectedGroup[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<AudienceTab>("users");

  const tabs: { id: AudienceTab; label: string; count: number }[] = [
    { id: "users", label: "Users", count: selectedUsers.length },
    { id: "departments", label: "Departments", count: selectedDepartments.length },
    { id: "roles", label: "Roles", count: selectedRoles.length },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-border" role="tablist" aria-label="Audience source">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id ? "border-cta text-cta" : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {tab.label}
            {tab.count > 0 && <span className="ml-1.5 text-xs text-muted">({tab.count})</span>}
          </button>
        ))}
      </div>

      {activeTab === "users" && <UsersPickerList subdomain={subdomain} selected={selectedUsers} onChange={onUsersChange} />}
      {activeTab === "departments" && (
        <GroupPickerList
          items={departments}
          loading={departmentsLoading}
          error={departmentsError}
          onRetry={onRetryDepartments}
          selected={selectedDepartments}
          onChange={onDepartmentsChange}
          searchPlaceholder="Search departments…"
          emptyMessage="No departments yet — create one under Settings > Departments."
          icon={Building2}
          noun="department"
        />
      )}
      {activeTab === "roles" && (
        <GroupPickerList
          items={roles}
          loading={rolesLoading}
          error={rolesError}
          onRetry={onRetryRoles}
          selected={selectedRoles}
          onChange={onRolesChange}
          searchPlaceholder="Search roles…"
          emptyMessage="No roles yet — create one under Settings > Roles."
          icon={Shield}
          noun="role"
        />
      )}
    </div>
  );
}
