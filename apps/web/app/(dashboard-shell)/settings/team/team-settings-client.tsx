"use client";

import { createContext, useContext, useEffect, useRef, useState, type ComponentType, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Button, Input, Card, Badge, PageHeader, Pagination, Drawer } from "@tm/ui";
import { FormRenderer, useEffectiveForm, type FieldRendererProps } from "@tm/form-builder";

const API_BASE = "/tenant-api/tenant-auth";
const TENANT_API_BASE = "/tenant-api/tenant";
const PAGE_SIZE = 25;

interface DepartmentOption {
  id: string;
  name: string;
  status: "active" | "archived";
  parentDepartmentId: string | null;
}

interface RoleOption {
  id: string;
  name: string;
}

// Spec 013, research.md §3 — GET /tenant/departments returns flat rows with parentDepartmentId but
// no precomputed hierarchy path string; this walks the already-fetched flat list to build one
// (e.g. "Engineering > Backend"), mirroring the ancestor-walking technique Department's own screen
// already uses for a related purpose (custom-fields-render-merge-order-style search-with-ancestors).
function departmentPath(departmentId: string, allDepartments: DepartmentOption[]): string {
  const byId = new Map(allDepartments.map((d) => [d.id, d]));
  const segments: string[] = [];
  let current: DepartmentOption | undefined = byId.get(departmentId);
  while (current) {
    segments.unshift(current.name);
    current = current.parentDepartmentId ? byId.get(current.parentDepartmentId) : undefined;
  }
  return segments.join(" > ");
}

interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  roleId: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string | null;
  accountStatus: "invited" | "active";
  isArchived: boolean;
  invitedByName: string | null;
  invitedAt: string;
}

interface MemberListMeta {
  page: number;
  pageSize: number;
  total: number;
  reason: "no_department_assigned" | null;
}

function MemberAvatar({ fullName }: { fullName: string }) {
  return <span className="shell-profile-avatar">{fullName.charAt(0).toUpperCase()}</span>;
}

// Label-left/value-right row, matching the reference profile-panel layout (a fixed-width label
// column beside the value) rather than the stacked label-above-value treatment used elsewhere in
// this codebase. No divider between rows, per direct product feedback.
function ProfileFieldRow({ label, value, placeholder }: { label: string; value: React.ReactNode; placeholder: string }) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-center gap-6 py-3">
      <span className="w-36 shrink-0 text-sm text-slate-500">{label}</span>
      {isEmpty ? (
        <span className="text-sm italic text-slate-400">{placeholder}</span>
      ) : (
        <span className="text-sm font-medium text-primary">{value}</span>
      )}
    </div>
  );
}

// Spec 013 (Add/Edit Team Member) — the Role and Department fields are required to be searchable,
// not a plain <select> (which is all this codebase had before); no combobox primitive exists yet
// anywhere in packages/ui, so this is a small, local, first-use component (same precedent as
// RowActionsMenu — built per-screen before any generalization).
function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  allowClear,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  allowClear?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <input
        className="field-input"
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onClick={() => {
          // A click while the input already has DOM focus (e.g. re-clicking right after picking
          // an option) never fires `onFocus` again, since focus never actually left the element —
          // only closing the dropdown. Reopen here too, but only reset the query on the transition
          // into open, so clicking to reposition the cursor mid-search doesn't clear it.
          if (!open) {
            setOpen(true);
            setQuery("");
          }
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-card-md">
          {allowClear && (
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm italic text-slate-400 hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              — None —
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-400">No matches</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface MemberFormFieldState {
  formFullName: string;
  setFormFullName: Dispatch<SetStateAction<string>>;
  formEmail: string;
  setFormEmail: Dispatch<SetStateAction<string>>;
  formRoleId: string;
  setFormRoleId: Dispatch<SetStateAction<string>>;
  formDepartmentId: string;
  setFormDepartmentId: Dispatch<SetStateAction<string>>;
  editingMemberId: string | null;
  roleOptions: RoleOption[];
  activeDepartmentOptions: DepartmentOption[];
  allDepartments: DepartmentOption[];
}

/** Backs Member's `fieldRenderers` overrides (spec FR-029) — Full name/Email/Role/Department all
 * need feature-specific behavior a generic input can't provide (Role/Department are searchable
 * comboboxes; Email is disabled once editing). Module-level context, not props recreated inline,
 * so these components' identities stay stable across renders (see the equivalent note in
 * department-settings-client.tsx — inline component definitions would remount on every
 * keystroke). */
const MemberFieldContext = createContext<MemberFormFieldState | null>(null);

function useMemberFieldContext(): MemberFormFieldState {
  const ctx = useContext(MemberFieldContext);
  if (!ctx) throw new Error("Member field renderers must be used inside MemberFieldContext");
  return ctx;
}

function FullNameField({ error }: FieldRendererProps) {
  const { formFullName, setFormFullName } = useMemberFieldContext();
  return <Input label="Full name" required error={error} value={formFullName} onChange={(e) => setFormFullName(e.target.value)} />;
}

function MemberEmailField({ error }: FieldRendererProps) {
  const { formEmail, setFormEmail, editingMemberId } = useMemberFieldContext();
  return (
    <Input
      label="Email"
      type="email"
      required
      error={error}
      disabled={!!editingMemberId}
      hint={editingMemberId ? "Email can't be changed here." : undefined}
      value={formEmail}
      onChange={(e) => setFormEmail(e.target.value)}
    />
  );
}

function RoleField() {
  const { formRoleId, setFormRoleId, roleOptions } = useMemberFieldContext();
  return (
    <div>
      <label className="field-label" htmlFor="roleId">
        Role
      </label>
      <SearchableSelect value={formRoleId} onChange={setFormRoleId} options={roleOptions.map((r) => ({ id: r.id, label: r.name }))} placeholder="Search roles…" />
    </div>
  );
}

function DepartmentField() {
  const { formDepartmentId, setFormDepartmentId, activeDepartmentOptions, allDepartments } = useMemberFieldContext();
  return (
    <div>
      <label className="field-label" htmlFor="departmentId">
        Department
      </label>
      <SearchableSelect
        value={formDepartmentId}
        onChange={setFormDepartmentId}
        options={activeDepartmentOptions.map((d) => ({ id: d.id, label: departmentPath(d.id, allDepartments) }))}
        placeholder="Search departments…"
        allowClear
      />
    </div>
  );
}

const MEMBER_FIELD_RENDERERS: Record<string, ComponentType<FieldRendererProps>> = {
  full_name: FullNameField,
  email: MemberEmailField,
  role_id: RoleField,
  department_id: DepartmentField,
};

const ROW_ACTIONS_MENU_WIDTH = 140;
const ROW_ACTIONS_MENU_HEIGHT = 84;

// Mirrors settings/forms's own FieldRowActionsMenu (portal-based, click-outside-to-close).
// Archiving is hidden entirely for the caller's own row — mirrors the server-side self-archive
// guard (tenant-team-routes.ts) with a matching UX affordance, not just a 422 after the fact.
function RowActionsMenu({
  onEdit,
  onToggleArchive,
  isArchived,
  isSelf,
}: {
  onEdit: () => void;
  onToggleArchive: () => void;
  isArchived: boolean;
  isSelf: boolean;
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
        aria-label="Member actions"
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
            {!isSelf && (
              <button
                type="button"
                className={
                  isArchived
                    ? "block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                    : "block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                }
                onClick={() => {
                  setOpen(false);
                  onToggleArchive();
                }}
              >
                {isArchived ? "Un-archive" : "Archive"}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

const PROFILE_TABS = [
  { key: "profile", label: "Profile" },
  { key: "activity", label: "Activity" },
] as const;
type ProfileTabKey = (typeof PROFILE_TABS)[number]["key"];

export default function TeamSettingsClient({
  subdomain,
  currentUserId,
  canViewAll,
  canAddMember,
  canManageMembers,
}: {
  subdomain: string;
  currentUserId: string;
  canViewAll: boolean;
  canAddMember: boolean;
  canManageMembers: boolean;
}) {
  const queryClient = useQueryClient();

  const departmentsQuery = useQuery({
    queryKey: ["team-departments", subdomain],
    queryFn: async () => {
      const res = await fetch(`${TENANT_API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      const json = (res.ok ? await res.json() : { data: [] }) as { data: DepartmentOption[] };
      return json.data;
    },
  });
  const allDepartments = departmentsQuery.data ?? [];
  const activeDepartmentOptions = allDepartments.filter((d) => d.status === "active");

  const rolesQuery = useQuery({
    queryKey: ["team-roles", subdomain],
    queryFn: async () => {
      const res = await fetch(`${TENANT_API_BASE}/roles?subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      const json = (res.ok ? await res.json() : { data: [] }) as { data: RoleOption[] };
      return json.data;
    },
  });
  const roleOptions = rolesQuery.data ?? [];

  // Directory (spec 012, User Story 1)
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState<string | null>(null);

  // Profile drawer (spec 012, User Story 4) — the "member" form's custom fields are the same set
  // for every member, fetched once and reused; only the values are per-member and lazy-fetched when
  // a row is clicked (research.md §4/§7 — reuses the existing, already-generic Custom Fields
  // Framework routes, no new endpoint).
  const [viewTargetId, setViewTargetId] = useState<string | null>(null);

  // Form Builder spec (033) — the effective form (system + platform + tenant fields, merged and
  // ordered) replaces the old `GET /form-fields?formKey=member` fetch. `full_name`/`email`/
  // `role_id`/`department_id` are `isSystem` rows this page still renders with dedicated
  // controls (via `MEMBER_FIELD_RENDERERS`, spec FR-029); only real tenant custom fields render
  // generically.
  const { form: memberEffectiveForm } = useEffectiveForm("member", subdomain);
  const layoutFields = memberEffectiveForm?.steps.flatMap((step) => step.sections.flatMap((section) => section.fields)) ?? [];
  const tenantCustomFields = layoutFields.filter((f) => !f.isSystem);
  const [viewValues, setViewValues] = useState<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState<ProfileTabKey>("profile");

  // Create/Edit form drawer (spec 013) — one shared drawer for both creating a member (spec
  // Assumptions/FR-018) and editing an existing one (spec 013 US2); `editingMemberId === null` means
  // create mode.
  const [formOpen, setFormOpen] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [formFullName, setFormFullName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRoleId, setFormRoleId] = useState("");
  const [formDepartmentId, setFormDepartmentId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // The tenant's own "member" custom fields, rendered by `<FormRenderer>` alongside the fixed
  // system fields above, in the merged order `useEffectiveForm("member", subdomain)` returns.
  const [formCustomFieldValues, setFormCustomFieldValues] = useState<Record<string, unknown>>({});
  const [formCustomFieldErrors, setFormCustomFieldErrors] = useState<Record<string, string>>({});

  const editMemberCustomFieldValuesQuery = useQuery({
    queryKey: ["member-custom-field-values", editingMemberId, subdomain],
    queryFn: async () => {
      const res = await fetch(
        `${TENANT_API_BASE}/custom-field-values?formKey=member&entityId=${editingMemberId}&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      const json = (res.ok ? await res.json() : { data: {} }) as { data: Record<string, unknown> };
      return json.data;
    },
    enabled: !!editingMemberId,
  });

  useEffect(() => {
    if (editingMemberId && editMemberCustomFieldValuesQuery.data) {
      setFormCustomFieldValues(editMemberCustomFieldValuesQuery.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMemberCustomFieldValuesQuery.data]);

  function openCreateForm() {
    setEditingMemberId(null);
    setFormFullName("");
    setFormEmail("");
    setFormRoleId("");
    setFormDepartmentId("");
    setFormCustomFieldValues({});
    setFormCustomFieldErrors({});
    setFormError(null);
    setFormOpen(true);
  }

  // Spec 013 US2 — pre-filled with the member's current values (never a blank form for an edit),
  // reusing the same shared form the create flow uses.
  function openEditForm(member: MemberRow) {
    setViewTargetId(null);
    setEditingMemberId(member.id);
    setFormFullName(member.fullName);
    setFormEmail(member.email);
    setFormRoleId(member.roleId);
    setFormDepartmentId(member.departmentId ?? "");
    setFormCustomFieldValues({});
    setFormCustomFieldErrors({});
    setFormError(null);
    setFormOpen(true);
  }

  function validateFormCustomFields(): boolean {
    const errors: Record<string, string> = {};
    for (const field of tenantCustomFields) {
      const value = formCustomFieldValues[field.fieldKey];
      const isEmpty = value === undefined || value === null || value === "";
      if (isEmpty) {
        if (field.isRequired) {
          errors[field.fieldKey] = `${field.label} is required`;
        }
        continue;
      }
      if (field.fieldType === "number" && typeof value !== "number") {
        errors[field.fieldKey] = `${field.label} must be a number`;
      }
    }
    setFormCustomFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // FormRenderer needs one flat `values` object keyed by `fieldKey` (mirrors Department's
  // `rendererValues`) — system field values live in the page's own `formFullName`/`formEmail`/
  // `formRoleId`/`formDepartmentId` state (owned via `MEMBER_FIELD_RENDERERS` below), custom
  // field values in `formCustomFieldValues`.
  const memberRendererValues = {
    full_name: formFullName,
    email: formEmail,
    role_id: formRoleId,
    department_id: formDepartmentId,
    ...formCustomFieldValues,
  };

  function handleMemberFieldChange(fieldKey: string, value: unknown) {
    setFormCustomFieldValues((v) => ({ ...v, [fieldKey]: value }));
  }

  const memberFieldContextValue: MemberFormFieldState = {
    formFullName,
    setFormFullName,
    formEmail,
    setFormEmail,
    formRoleId,
    setFormRoleId,
    formDepartmentId,
    setFormDepartmentId,
    editingMemberId,
    roleOptions,
    activeDepartmentOptions,
    allDepartments,
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [departmentFilter]);

  const membersQuery = useQuery({
    queryKey: ["team-members", subdomain, page, debouncedSearch, departmentFilter, includeArchived],
    queryFn: async () => {
      const params = new URLSearchParams({
        subdomain,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (canViewAll && departmentFilter) params.set("departmentId", departmentFilter);
      if (includeArchived) params.set("includeArchived", "true");

      const res = await fetch(`${TENANT_API_BASE}/team?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load team members");
      return (await res.json()) as { data: MemberRow[]; meta: MemberListMeta };
    },
  });
  const members = membersQuery.data?.data ?? null;
  const meta = membersQuery.data?.meta ?? null;

  useEffect(() => {
    if (membersQuery.isError) setListError("Couldn't load team members. Try again.");
  }, [membersQuery.isError]);

  function reloadMembers() {
    queryClient.invalidateQueries({ queryKey: ["team-members", subdomain] });
  }

  const toggleArchiveMutation = useMutation({
    mutationFn: async (member: MemberRow) => {
      const res = await fetch(`${TENANT_API_BASE}/team/${member.id}?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: !member.isArchived }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't update this team member. Try again.");
      }
    },
    onSuccess: () => {
      setListError(null);
      reloadMembers();
    },
    onError: (err: Error) => setListError(err.message),
  });

  function handleToggleArchive(member: MemberRow) {
    toggleArchiveMutation.mutate(member);
  }

  const viewValuesQuery = useQuery({
    queryKey: ["member-custom-field-values", viewTargetId, subdomain],
    queryFn: async () => {
      const res = await fetch(
        `${TENANT_API_BASE}/custom-field-values?formKey=member&entityId=${viewTargetId}&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      const json = (res.ok ? await res.json() : { data: {} }) as { data: Record<string, unknown> };
      return json.data;
    },
    enabled: !!viewTargetId,
  });

  useEffect(() => {
    setViewValues(viewValuesQuery.data ?? {});
  }, [viewValuesQuery.data]);

  function openProfile(memberId: string) {
    setViewTargetId(memberId);
    setActiveTab("profile");
  }

  const saveMemberMutation = useMutation({
    mutationFn: async () => {
      const res = editingMemberId
        ? await fetch(`${TENANT_API_BASE}/team/${editingMemberId}?subdomain=${encodeURIComponent(subdomain)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fullName: formFullName,
              roleId: formRoleId,
              departmentId: formDepartmentId || null,
              customFieldValues: formCustomFieldValues,
            }),
          })
        : await fetch(`${API_BASE}/team?subdomain=${encodeURIComponent(subdomain)}`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fullName: formFullName,
              email: formEmail,
              roleId: formRoleId,
              departmentId: formDepartmentId || undefined,
              customFieldValues: formCustomFieldValues,
            }),
          });
      if (res.status !== 201 && res.status !== 200) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this team member. Try again.");
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      reloadMembers();
    },
    onError: (err: Error) => setFormError(err.message || "Couldn't reach the server. Try again."),
  });

  // Called from `<FormRenderer onSubmit={...}>` — FormRenderer has already run its own
  // client-side required/type validation against every field, including custom ones, before
  // ever calling this.
  function handleFormSubmit() {
    setFormError(null);
    if (!formRoleId) {
      setFormError("Role is required.");
      return;
    }
    if (!validateFormCustomFields()) {
      return;
    }
    saveMemberMutation.mutate();
  }

  const descriptionLine = canViewAll
    ? "View and manage everyone in your organization."
    : "View and manage members of your department.";

  const viewTarget = viewTargetId ? (members ?? []).find((m) => m.id === viewTargetId) ?? null : null;

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader title="Team Members" subtitle={descriptionLine} />
        {canAddMember && <Button onClick={openCreateForm}>+ Add member</Button>}
      </div>

      {listError && <div className="banner-error mt-4">{listError}</div>}

      <div className="mt-6 flex items-center gap-3">
        <Input
          aria-label="Search by name or email"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {canViewAll && (
          <select
            className="field-input max-w-xs"
            aria-label="Filter by department"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="">All departments</option>
            {allDepartments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        {canManageMembers && (
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Include archived
          </label>
        )}
      </div>

      <Card className="mt-4 overflow-hidden p-0">
        {members === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : meta?.reason === "no_department_assigned" ? (
          <div className="p-8 text-center text-sm text-slate-500">
            You aren&apos;t assigned to a department yet — ask an admin to assign you one to see your
            team.
          </div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No members match your search or filter.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-10 px-4 py-2" />
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Role</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Department</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Email</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Account status</th>
                {canManageMembers && (
                  <th className="px-4 py-2 text-right font-medium text-slate-600">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.id}
                  className="cursor-pointer border-t border-border hover:bg-slate-50"
                  onClick={() => openProfile(member.id)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${member.fullName}`} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <MemberAvatar fullName={member.fullName} />
                      <span className="text-sm text-primary">{member.fullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary">{member.roleName}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{member.departmentName ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{member.email}</td>
                  <td className="px-4 py-3 text-sm">
                    {member.isArchived ? (
                      <Badge variant="neutral">Archived</Badge>
                    ) : (
                      <Badge variant={member.accountStatus === "active" ? "success" : "warning"}>
                        {member.accountStatus === "active" ? "Active" : "Invited"}
                      </Badge>
                    )}
                  </td>
                  {canManageMembers && (
                    <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          onEdit={() => openEditForm(member)}
                          onToggleArchive={() => handleToggleArchive(member)}
                          isArchived={member.isArchived}
                          isSelf={member.id === currentUserId}
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

      {meta && meta.total > 0 && (
        <Pagination
          className="mt-3"
          page={meta.page}
          pageSize={meta.pageSize}
          total={meta.total}
          onPageChange={setPage}
        />
      )}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        side="right"
        title={editingMemberId ? "Edit team member" : "Add team member"}
      >
        {!editingMemberId && (
          <p className="text-sm text-slate-600">
            They&apos;ll receive an email with a one-time password to get started.
          </p>
        )}

        {formError && <div className="banner-error mt-4">{formError}</div>}

        <div className="mt-4">
          <MemberFieldContext.Provider value={memberFieldContextValue}>
            <FormRenderer
              form={memberEffectiveForm}
              values={memberRendererValues}
              onChange={handleMemberFieldChange}
              onSubmit={handleFormSubmit}
              errors={formCustomFieldErrors}
              isSubmitting={saveMemberMutation.isPending}
              fieldRenderers={MEMBER_FIELD_RENDERERS}
              submitLabel={editingMemberId ? "Save changes" : "Add team member"}
              subdomain={subdomain}
            />
          </MemberFieldContext.Provider>
        </div>
      </Drawer>

      <Drawer open={!!viewTarget} onClose={() => setViewTargetId(null)} side="right" title="Member profile">
        {viewTarget && (
          <div>
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <MemberAvatar fullName={viewTarget.fullName} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-primary">{viewTarget.fullName}</h3>
                  {viewTarget.isArchived ? (
                    <Badge variant="neutral">Archived</Badge>
                  ) : (
                    <Badge variant={viewTarget.accountStatus === "active" ? "success" : "warning"}>
                      {viewTarget.accountStatus === "active" ? "Active" : "Invited"}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-slate-500">{viewTarget.roleName}</p>
              </div>
            </div>

            <div className="flex gap-6 border-b border-border">
              {PROFILE_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`cursor-pointer border-b-2 py-2.5 text-sm font-medium ${
                    activeTab === tab.key
                      ? "border-cta text-cta"
                      : "border-transparent text-slate-500 hover:text-primary"
                  }`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "profile" && (
              <div className="mt-2">
                <ProfileFieldRow label="Full name" value={viewTarget.fullName} placeholder="" />
                <ProfileFieldRow label="Email" value={viewTarget.email} placeholder="" />
                <ProfileFieldRow label="Role" value={viewTarget.roleName} placeholder="" />
                <ProfileFieldRow
                  label="Department"
                  value={viewTarget.departmentName}
                  placeholder="No department assigned"
                />
                {tenantCustomFields.map((field) => {
                  const value = viewValues[field.fieldKey];
                  const display = Array.isArray(value) ? value.join(", ") : (value as string | number | undefined);
                  return <ProfileFieldRow key={field.id} label={field.label} value={display} placeholder="Not set" />;
                })}
              </div>
            )}

            {activeTab === "activity" && (
              <div className="mt-2">
                <ProfileFieldRow label="Invited by" value={viewTarget.invitedByName} placeholder="Not recorded" />
                <ProfileFieldRow
                  label="Invited on"
                  value={new Date(viewTarget.invitedAt).toLocaleDateString()}
                  placeholder="Not recorded"
                />
              </div>
            )}

            {canManageMembers && (
              <Button className="mt-6 w-full" onClick={() => openEditForm(viewTarget)}>
                Edit member
              </Button>
            )}
            {canManageMembers && viewTarget.id !== currentUserId && (
              <Button
                variant="outline"
                className={`mt-2 w-full ${viewTarget.isArchived ? "" : "!text-red-600 !border-red-200"}`}
                onClick={() => {
                  handleToggleArchive(viewTarget);
                  setViewTargetId(null);
                }}
              >
                {viewTarget.isArchived ? "Un-archive member" : "Archive member"}
              </Button>
            )}
          </div>
        )}
      </Drawer>
    </main>
  );
}
