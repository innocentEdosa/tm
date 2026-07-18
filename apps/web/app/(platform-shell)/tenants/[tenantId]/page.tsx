"use client";

// Super Admin Tenant Console spec (020), extended by Super Admin Edit Tenant Configuration (022) —
// a tenant-scoped console reached via the "Manage" row action on the Tenants list
// (tenants/page.tsx). Renders inside the Super Admin's own platform dashboard shell — never by
// navigating to the tenant's own subdomain (spec 020 FR-002). Single-file Client Component,
// matching this shell's established convention (tenants/page.tsx, admin/permissions/page.tsx).
// Spec 022 formally reverses spec 020's FR-014 — this page now edits members, roles, departments,
// and custom field definitions, each via a Modal, matching the same pattern already proven by the
// Add Member modal (spec 021).
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ApiResponse } from "@tm/types";
import { Badge, Button, Input, Modal, Pagination } from "@tm/ui";

const API_BASE = "/platform-api";
const PAGE_SIZE = 25;
const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect"] as const;
type FieldType = (typeof FIELD_TYPES)[number];

interface TenantDetail {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  isArchived: boolean;
  isPendingDeletion: boolean;
  primaryContactName: string;
  primaryContactEmail: string;
  createdAt: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  parentDepartmentId: string | null;
  memberCount: number;
  hasChildren: boolean;
  manager: { id: string; fullName: string } | null;
  assistantManager: { id: string; fullName: string } | null;
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  isSystem: boolean;
  memberCount: number;
}

interface PermissionCatalogEntry {
  key: string;
  displayName: string;
  description: string;
  category: string;
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
  archived: boolean;
}

interface MembersData {
  members: MemberRow[];
  meta: { page: number; pageSize: number; total: number };
}

interface FormDefinitionRow {
  key: string;
  name: string;
  description: string;
}

interface FieldRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: string[] | null;
  isRequired: boolean;
  scope: "system" | "global" | "tenant";
  isSystem: boolean;
}

type Tab = "company" | "departments" | "roles" | "members" | "forms";

const TABS: { id: Tab; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "departments", label: "Departments" },
  { id: "roles", label: "Roles" },
  { id: "members", label: "Members" },
  { id: "forms", label: "Forms" },
];

function statusBadgeVariant(status: string): "success" | "accent" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "trial") return "accent";
  return "warning";
}

/**
 * `navigator.clipboard` only exists in a secure context (HTTPS, or the literal hostname
 * "localhost") — over plain HTTP on any other hostname (e.g. local dev's `http://lvh.me:3010`, or
 * any tenant subdomain that hasn't yet gotten HTTPS), it's `undefined` and silently does nothing.
 * Falls back to the older `execCommand("copy")` path via a temporary off-screen textarea, which
 * works regardless of secure-context status.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback below
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  }
  document.body.removeChild(textarea);
  return succeeded;
}

/** Builds a parent-id → children map and renders each department indented by its depth in the
 * hierarchy — the same visual idiom as the tenant-side department-settings-client.tsx. Spec 022 adds
 * an Edit action per row (previously read-only, spec 020 FR-014). */
function renderDepartmentRows(
  departments: DepartmentRow[],
  parentId: string | null,
  depth: number,
  onEdit: (dept: DepartmentRow) => void,
): React.ReactNode[] {
  const rows = departments.filter((d) => d.parentDepartmentId === parentId);
  return rows.flatMap((dept) => {
    const row = (
      <tr key={dept.id} className="border-t border-border">
        <td className="px-4 py-3 text-sm text-primary">
          <span style={{ paddingLeft: `${depth * 20}px` }}>{dept.name}</span>
        </td>
        <td className="px-4 py-3 text-sm text-secondary">{dept.memberCount}</td>
        <td className="px-4 py-3 text-sm">
          <Badge variant={dept.status === "active" ? "success" : "neutral"}>
            {dept.status === "active" ? "Active" : "Archived"}
          </Badge>
        </td>
        <td className="px-4 py-3 text-sm text-secondary">{dept.manager?.fullName ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-secondary">{dept.assistantManager?.fullName ?? "—"}</td>
        <td className="px-4 py-3 text-right">
          <Button type="button" variant="outline" onClick={() => onEdit(dept)}>
            Edit
          </Button>
        </td>
      </tr>
    );
    return [row, ...renderDepartmentRows(departments, dept.id, depth + 1, onEdit)];
  });
}

interface DepartmentFormState {
  name: string;
  description: string;
  parentDepartmentId: string;
  status: "active" | "archived";
  managerId: string;
  assistantManagerId: string;
}

const EMPTY_DEPARTMENT_FORM: DepartmentFormState = {
  name: "",
  description: "",
  parentDepartmentId: "",
  status: "active",
  managerId: "",
  assistantManagerId: "",
};

interface RoleFormState {
  name: string;
  description: string;
  permissionKeys: Set<string>;
}

const EMPTY_ROLE_FORM: RoleFormState = { name: "", description: "", permissionKeys: new Set() };

interface FieldFormState {
  label: string;
  fieldKey: string;
  fieldType: FieldType;
  options: string;
  isRequired: boolean;
}

const EMPTY_FIELD_FORM: FieldFormState = {
  label: "",
  fieldKey: "",
  fieldType: "text",
  options: "",
  isRequired: false,
};

export default function TenantConsolePage() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();
  const tenantId = params.tenantId;

  const [tab, setTab] = useState<Tab>("company");
  const [tenant, setTenant] = useState<TenantDetail | null | "loading" | "error" | "unauthenticated">(
    "loading",
  );
  const [departments, setDepartments] = useState<DepartmentRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [members, setMembers] = useState<MembersData | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionCatalogEntry[] | null>(null);

  const [resetTarget, setResetTarget] = useState<MemberRow | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ member: MemberRow; password: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  // Super Admin Add Member spec (021)
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberForm, setAddMemberForm] = useState({
    fullName: "",
    email: "",
    roleId: "",
    departmentId: "",
  });
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const [addMemberSubmitting, setAddMemberSubmitting] = useState(false);

  // Super Admin Edit Tenant Configuration spec (022) — Edit Member
  const [editMemberTarget, setEditMemberTarget] = useState<MemberRow | null>(null);
  const [editMemberForm, setEditMemberForm] = useState({
    fullName: "",
    roleId: "",
    departmentId: "",
    archived: false,
  });
  const [editMemberCustomFieldValues, setEditMemberCustomFieldValues] = useState<Record<string, unknown>>({});
  const [editMemberFields, setEditMemberFields] = useState<FieldRow[] | null>(null);
  const [editMemberError, setEditMemberError] = useState<string | null>(null);
  const [editMemberSubmitting, setEditMemberSubmitting] = useState(false);

  // Spec 022 — Roles: create/edit
  const [roleModalOpen, setRoleModalOpen] = useState<{ mode: "create" | "edit"; roleId?: string } | null>(null);
  const [roleForm, setRoleForm] = useState<RoleFormState>(EMPTY_ROLE_FORM);
  const [roleFormError, setRoleFormError] = useState<string | null>(null);
  const [roleFormSubmitting, setRoleFormSubmitting] = useState(false);
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<RoleRow | null>(null);
  const [deleteRoleError, setDeleteRoleError] = useState<string | null>(null);
  const [deleteRoleSubmitting, setDeleteRoleSubmitting] = useState(false);

  // Spec 022 — Departments: create/edit
  const [departmentModalOpen, setDepartmentModalOpen] = useState<{ mode: "create" | "edit"; departmentId?: string } | null>(
    null,
  );
  const [departmentForm, setDepartmentForm] = useState<DepartmentFormState>(EMPTY_DEPARTMENT_FORM);
  const [departmentFormError, setDepartmentFormError] = useState<string | null>(null);
  const [departmentFormSubmitting, setDepartmentFormSubmitting] = useState(false);

  // Spec 022 — Forms tab: form-type selector + field list + create/edit field
  const [formDefinitions, setFormDefinitions] = useState<FormDefinitionRow[] | null>(null);
  const [selectedFormKey, setSelectedFormKey] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<FieldRow[] | null>(null);
  const [fieldModalOpen, setFieldModalOpen] = useState<{ mode: "create" | "edit"; fieldId?: string } | null>(null);
  const [fieldForm, setFieldForm] = useState<FieldFormState>(EMPTY_FIELD_FORM);
  const [fieldFormError, setFieldFormError] = useState<string | null>(null);
  const [fieldFormSubmitting, setFieldFormSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/tenants/${tenantId}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setTenant("unauthenticated");
          return;
        }
        if (res.status === 404) {
          setTenant(null);
          return;
        }
        if (!res.ok) {
          setTenant("error");
          return;
        }
        const json = (await res.json()) as ApiResponse<TenantDetail>;
        setTenant(json.data);
      })
      .catch(() => {
        if (!cancelled) setTenant("error");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (tenant === "unauthenticated") router.replace("/platform/login");
  }, [tenant, router]);

  const loadDepartments = useCallback(() => {
    fetch(`${API_BASE}/tenants/${tenantId}/departments`, { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((json: ApiResponse<DepartmentRow[]>) => setDepartments(json.data ?? []));
  }, [tenantId]);

  const loadRoles = useCallback(() => {
    fetch(`${API_BASE}/tenants/${tenantId}/roles`, { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((json: ApiResponse<RoleRow[]>) => setRoles(json.data ?? []));
  }, [tenantId]);

  const loadPermissionCatalog = useCallback(() => {
    fetch(`${API_BASE}/tenants/${tenantId}/permission-catalog`, { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((json: ApiResponse<PermissionCatalogEntry[]>) => setPermissionCatalog(json.data ?? []));
  }, [tenantId]);

  useEffect(() => {
    if (tab !== "departments" || departments !== null) return;
    loadDepartments();
  }, [tab, departments, loadDepartments]);

  useEffect(() => {
    if (tab !== "roles" || roles !== null) return;
    loadRoles();
    if (permissionCatalog === null) loadPermissionCatalog();
  }, [tab, roles, loadRoles, permissionCatalog, loadPermissionCatalog]);

  const loadMembers = useCallback(() => {
    const query = new URLSearchParams({
      page: String(memberPage),
      pageSize: String(PAGE_SIZE),
      ...(memberSearch ? { search: memberSearch } : {}),
    });
    fetch(`${API_BASE}/tenants/${tenantId}/members?${query}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json: ApiResponse<MemberRow[]> & { meta?: MembersData["meta"] }) => {
        setMembers({
          members: json.data ?? [],
          meta: json.meta ?? { page: memberPage, pageSize: PAGE_SIZE, total: 0 },
        });
      });
  }, [tenantId, memberPage, memberSearch]);

  useEffect(() => {
    if (tab !== "members") return;
    loadMembers();
  }, [tab, loadMembers]);

  const loadFormDefinitions = useCallback(() => {
    fetch(`${API_BASE}/tenants/${tenantId}/form-definitions`, { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((json: ApiResponse<FormDefinitionRow[]>) => {
        const data = json.data ?? [];
        setFormDefinitions(data);
        if (data.length > 0) setSelectedFormKey((current) => current ?? data[0].key);
      });
  }, [tenantId]);

  const loadFormFields = useCallback(
    (formKey: string) => {
      fetch(`${API_BASE}/tenants/${tenantId}/custom-fields?formKey=${encodeURIComponent(formKey)}`, {
        credentials: "include",
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((json: ApiResponse<FieldRow[]>) => setFormFields(json.data ?? []));
    },
    [tenantId],
  );

  useEffect(() => {
    if (tab !== "forms") return;
    if (formDefinitions === null) loadFormDefinitions();
  }, [tab, formDefinitions, loadFormDefinitions]);

  useEffect(() => {
    if (tab !== "forms" || !selectedFormKey) return;
    setFormFields(null);
    loadFormFields(selectedFormKey);
  }, [tab, selectedFormKey, loadFormFields]);

  async function submitReset() {
    if (!resetTarget) return;
    setResetSubmitting(true);
    setResetError(null);
    try {
      const res = await fetch(
        `${API_BASE}/tenants/${tenantId}/members/${resetTarget.id}/reset-password`,
        { method: "POST", credentials: "include" },
      );
      const json = (await res.json()) as ApiResponse<{ generatedPassword: string }>;
      if (!res.ok || !json.success) {
        setResetError(json.message ?? "Couldn't reset this member's password. Try again.");
        return;
      }
      setResetResult({ member: resetTarget, password: json.data.generatedPassword });
      setCopyState("idle");
      setResetTarget(null);
    } catch {
      setResetError("Couldn't reach the server. Try again.");
    } finally {
      setResetSubmitting(false);
    }
  }

  function openAddMember() {
    setAddMemberForm({ fullName: "", email: "", roleId: "", departmentId: "" });
    setAddMemberError(null);
    setAddMemberOpen(true);
    // The Add Member form needs the tenant's roles/departments regardless of which tab is
    // currently active — fetch them here too if the Roles/Departments tabs haven't been visited
    // yet (spec 021 research.md §5).
    if (roles === null) loadRoles();
    if (departments === null) loadDepartments();
  }

  async function submitAddMember() {
    setAddMemberSubmitting(true);
    setAddMemberError(null);
    try {
      const res = await fetch(`${API_BASE}/tenants/${tenantId}/members`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: addMemberForm.fullName.trim(),
          email: addMemberForm.email.trim(),
          roleId: addMemberForm.roleId,
          departmentId: addMemberForm.departmentId || undefined,
        }),
      });
      const json = (await res.json()) as ApiResponse<{ id: string; email: string }>;
      if (!res.ok || !json.success) {
        setAddMemberError(json.message ?? "Couldn't add this member. Try again.");
        return;
      }
      setAddMemberOpen(false);
      loadMembers();
    } catch {
      setAddMemberError("Couldn't reach the server. Try again.");
    } finally {
      setAddMemberSubmitting(false);
    }
  }

  // Spec 022 — Edit Member
  function openEditMember(member: MemberRow) {
    setEditMemberTarget(member);
    setEditMemberForm({
      fullName: member.fullName,
      roleId: member.roleId,
      departmentId: member.departmentId ?? "",
      archived: member.archived,
    });
    setEditMemberCustomFieldValues({});
    setEditMemberFields(null);
    setEditMemberError(null);
    if (roles === null) loadRoles();
    if (departments === null) loadDepartments();
    fetch(`${API_BASE}/tenants/${tenantId}/members/${member.id}/custom-field-values`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json: ApiResponse<Record<string, unknown>>) => setEditMemberCustomFieldValues(json.data ?? {}))
      .catch(() => {});
    fetch(`${API_BASE}/tenants/${tenantId}/custom-fields?formKey=member`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json: ApiResponse<FieldRow[]>) => setEditMemberFields(json.data ?? []))
      .catch(() => setEditMemberFields([]));
  }

  function renderEditMemberCustomField(field: FieldRow): React.ReactNode {
    const inputId = `edit-member-custom-${field.fieldKey}`;
    return (
      <div key={field.id}>
        <label className="field-label" htmlFor={inputId}>
          {field.label}
          {field.isRequired ? " *" : ""}
        </label>
        {field.fieldType === "textarea" ? (
          <textarea
            id={inputId}
            className="field-input"
            rows={3}
            value={(editMemberCustomFieldValues[field.fieldKey] as string) ?? ""}
            onChange={(e) =>
              setEditMemberCustomFieldValues((v) => ({ ...v, [field.fieldKey]: e.target.value }))
            }
          />
        ) : field.fieldType === "select" ? (
          <select
            id={inputId}
            className="field-input"
            value={(editMemberCustomFieldValues[field.fieldKey] as string) ?? ""}
            onChange={(e) =>
              setEditMemberCustomFieldValues((v) => ({ ...v, [field.fieldKey]: e.target.value }))
            }
          >
            <option value="">— Select —</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.fieldType === "multiselect" ? (
          <select
            id={inputId}
            className="field-input"
            multiple
            value={(editMemberCustomFieldValues[field.fieldKey] as string[]) ?? []}
            onChange={(e) =>
              setEditMemberCustomFieldValues((v) => ({
                ...v,
                [field.fieldKey]: Array.from(e.target.selectedOptions, (o) => o.value),
              }))
            }
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={inputId}
            type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
            className="field-input"
            value={(editMemberCustomFieldValues[field.fieldKey] as string | number) ?? ""}
            onChange={(e) =>
              setEditMemberCustomFieldValues((v) => ({
                ...v,
                [field.fieldKey]: field.fieldType === "number" ? e.target.valueAsNumber : e.target.value,
              }))
            }
          />
        )}
      </div>
    );
  }

  async function submitEditMember() {
    if (!editMemberTarget) return;
    setEditMemberSubmitting(true);
    setEditMemberError(null);
    try {
      const res = await fetch(`${API_BASE}/tenants/${tenantId}/members/${editMemberTarget.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: editMemberForm.fullName.trim(),
          roleId: editMemberForm.roleId,
          departmentId: editMemberForm.departmentId || null,
          archived: editMemberForm.archived,
          customFieldValues: editMemberCustomFieldValues,
        }),
      });
      const json = (await res.json()) as ApiResponse<unknown> & { errors?: { fieldKey: string; message: string }[] };
      if (!res.ok || !json.success) {
        const message =
          json.message ?? json.errors?.map((e) => e.message).join(", ") ?? "Couldn't save this member. Try again.";
        setEditMemberError(message);
        return;
      }
      setEditMemberTarget(null);
      loadMembers();
    } catch {
      setEditMemberError("Couldn't reach the server. Try again.");
    } finally {
      setEditMemberSubmitting(false);
    }
  }

  // Spec 022 — Roles: create/edit/delete
  function openCreateRole() {
    setRoleForm(EMPTY_ROLE_FORM);
    setRoleFormError(null);
    setRoleModalOpen({ mode: "create" });
    if (permissionCatalog === null) loadPermissionCatalog();
  }

  function openEditRole(role: RoleRow) {
    setRoleForm({ name: role.name, description: role.description ?? "", permissionKeys: new Set(role.permissionKeys) });
    setRoleFormError(null);
    setRoleModalOpen({ mode: "edit", roleId: role.id });
    if (permissionCatalog === null) loadPermissionCatalog();
  }

  async function submitRoleForm() {
    if (!roleModalOpen) return;
    setRoleFormSubmitting(true);
    setRoleFormError(null);
    try {
      const payload = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || undefined,
        permissionKeys: Array.from(roleForm.permissionKeys),
      };
      const url =
        roleModalOpen.mode === "create"
          ? `${API_BASE}/tenants/${tenantId}/roles`
          : `${API_BASE}/tenants/${tenantId}/roles/${roleModalOpen.roleId}`;
      const res = await fetch(url, {
        method: roleModalOpen.mode === "create" ? "POST" : "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) {
        setRoleFormError(json.message ?? "Couldn't save this role. Try again.");
        return;
      }
      setRoleModalOpen(null);
      loadRoles();
    } catch {
      setRoleFormError("Couldn't reach the server. Try again.");
    } finally {
      setRoleFormSubmitting(false);
    }
  }

  async function submitDeleteRole() {
    if (!deleteRoleTarget) return;
    setDeleteRoleSubmitting(true);
    setDeleteRoleError(null);
    try {
      const res = await fetch(`${API_BASE}/tenants/${tenantId}/roles/${deleteRoleTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status !== 204) {
        const json = (await res.json().catch(() => ({}))) as ApiResponse<unknown>;
        setDeleteRoleError(json.message ?? "Couldn't delete this role. Try again.");
        return;
      }
      setDeleteRoleTarget(null);
      loadRoles();
    } catch {
      setDeleteRoleError("Couldn't reach the server. Try again.");
    } finally {
      setDeleteRoleSubmitting(false);
    }
  }

  function togglePermission(key: string) {
    setRoleForm((f) => {
      const next = new Set(f.permissionKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...f, permissionKeys: next };
    });
  }

  // Spec 022 — Departments: create/edit
  function openCreateDepartment() {
    setDepartmentForm(EMPTY_DEPARTMENT_FORM);
    setDepartmentFormError(null);
    setDepartmentModalOpen({ mode: "create" });
    if (members === null) loadMembers();
  }

  function openEditDepartment(dept: DepartmentRow) {
    setDepartmentForm({
      name: dept.name,
      description: dept.description ?? "",
      parentDepartmentId: dept.parentDepartmentId ?? "",
      status: dept.status === "archived" ? "archived" : "active",
      managerId: dept.manager?.id ?? "",
      assistantManagerId: dept.assistantManager?.id ?? "",
    });
    setDepartmentFormError(null);
    setDepartmentModalOpen({ mode: "edit", departmentId: dept.id });
    if (members === null) loadMembers();
  }

  async function submitDepartmentForm() {
    if (!departmentModalOpen) return;
    setDepartmentFormSubmitting(true);
    setDepartmentFormError(null);
    try {
      const payload = {
        name: departmentForm.name.trim(),
        description: departmentForm.description.trim() || undefined,
        parentDepartmentId: departmentForm.parentDepartmentId || null,
        status: departmentForm.status,
        managerId: departmentForm.managerId || null,
        assistantManagerId: departmentForm.assistantManagerId || null,
      };
      const url =
        departmentModalOpen.mode === "create"
          ? `${API_BASE}/tenants/${tenantId}/departments`
          : `${API_BASE}/tenants/${tenantId}/departments/${departmentModalOpen.departmentId}`;
      const res = await fetch(url, {
        method: departmentModalOpen.mode === "create" ? "POST" : "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) {
        setDepartmentFormError(json.message ?? "Couldn't save this department. Try again.");
        return;
      }
      setDepartmentModalOpen(null);
      loadDepartments();
    } catch {
      setDepartmentFormError("Couldn't reach the server. Try again.");
    } finally {
      setDepartmentFormSubmitting(false);
    }
  }

  // Spec 022 — Forms tab: create/edit/archive field
  function openCreateField() {
    setFieldForm(EMPTY_FIELD_FORM);
    setFieldFormError(null);
    setFieldModalOpen({ mode: "create" });
  }

  function openEditField(field: FieldRow) {
    setFieldForm({
      label: field.label,
      fieldKey: field.fieldKey,
      fieldType: field.fieldType,
      options: (field.options ?? []).join(", "),
      isRequired: field.isRequired,
    });
    setFieldFormError(null);
    setFieldModalOpen({ mode: "edit", fieldId: field.id });
  }

  async function submitFieldForm() {
    if (!fieldModalOpen || !selectedFormKey) return;
    setFieldFormSubmitting(true);
    setFieldFormError(null);
    try {
      const options =
        fieldForm.fieldType === "select" || fieldForm.fieldType === "multiselect"
          ? fieldForm.options.split(",").map((o) => o.trim()).filter(Boolean)
          : undefined;
      const url =
        fieldModalOpen.mode === "create"
          ? `${API_BASE}/tenants/${tenantId}/custom-fields`
          : `${API_BASE}/tenants/${tenantId}/custom-fields/${fieldModalOpen.fieldId}`;
      const payload =
        fieldModalOpen.mode === "create"
          ? {
              formKey: selectedFormKey,
              label: fieldForm.label.trim(),
              fieldKey: fieldForm.fieldKey.trim() || undefined,
              fieldType: fieldForm.fieldType,
              options,
              isRequired: fieldForm.isRequired,
            }
          : {
              label: fieldForm.label.trim(),
              fieldType: fieldForm.fieldType,
              options,
              isRequired: fieldForm.isRequired,
            };
      const res = await fetch(url, {
        method: fieldModalOpen.mode === "create" ? "POST" : "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) {
        setFieldFormError(json.message ?? "Couldn't save this field. Try again.");
        return;
      }
      setFieldModalOpen(null);
      loadFormFields(selectedFormKey);
    } catch {
      setFieldFormError("Couldn't reach the server. Try again.");
    } finally {
      setFieldFormSubmitting(false);
    }
  }

  async function archiveField(field: FieldRow) {
    if (!selectedFormKey) return;
    await fetch(`${API_BASE}/tenants/${tenantId}/custom-fields/${field.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    loadFormFields(selectedFormKey);
  }

  if (tenant === "loading" || tenant === "unauthenticated") {
    return <p className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-600">Loading…</p>;
  }

  if (tenant === "error") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div role="alert" className="banner-error">
          Couldn&apos;t load this tenant. Try again later.
        </div>
      </div>
    );
  }

  if (tenant === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/tenants" className="text-sm text-cta hover:underline">
          ← Back to Tenants
        </Link>
        <p className="mt-4 text-sm text-slate-600">This tenant could not be found.</p>
      </div>
    );
  }

  const groupedPermissions = (permissionCatalog ?? []).reduce<Map<string, PermissionCatalogEntry[]>>(
    (groups, entry) => {
      const list = groups.get(entry.category) ?? [];
      list.push(entry);
      groups.set(entry.category, list);
      return groups;
    },
    new Map(),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/tenants"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tenants
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">{tenant.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{tenant.subdomain}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={statusBadgeVariant(tenant.status)}>{tenant.status}</Badge>
          {tenant.isArchived && <Badge variant="warning">Archived</Badge>}
          {tenant.isPendingDeletion && <Badge variant="warning">Pending Deletion</Badge>}
        </div>
      </div>

      <div className="mt-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "border-b-2 border-cta px-4 py-2 text-sm font-medium text-primary"
                : "px-4 py-2 text-sm font-medium text-slate-600 hover:text-primary"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "company" && (
        <div className="mt-6 max-w-xl space-y-4 rounded-lg border border-border p-5">
          <div>
            <div className="text-xs font-medium uppercase text-slate-500">Primary contact</div>
            <div className="mt-1 text-sm text-primary">{tenant.primaryContactName}</div>
            <div className="text-sm text-slate-600">{tenant.primaryContactEmail}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-slate-500">Created</div>
            <div className="mt-1 text-sm text-primary">
              {new Date(tenant.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      )}

      {tab === "departments" && (
        <div className="mt-6">
          <div className="flex items-center justify-end">
            <Button type="button" onClick={openCreateDepartment}>
              New Department
            </Button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            {departments === null ? (
              <p className="p-4 text-sm text-slate-600">Loading…</p>
            ) : departments.length === 0 ? (
              <p className="p-4 text-sm text-slate-600">This tenant has no departments yet.</p>
            ) : (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Department
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Members
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Manager
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Assistant Manager
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>{renderDepartmentRows(departments, null, 0, openEditDepartment)}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="mt-6">
          <div className="flex items-center justify-end">
            <Button type="button" onClick={openCreateRole}>
              New Role
            </Button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            {roles === null ? (
              <p className="p-4 text-sm text-slate-600">Loading…</p>
            ) : roles.length === 0 ? (
              <p className="p-4 text-sm text-slate-600">This tenant has no custom roles yet.</p>
            ) : (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Permissions
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Members
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {roles.map((role) => (
                    <tr key={role.id}>
                      <td className="px-4 py-3 text-primary">
                        <div className="font-medium">{role.name}</div>
                        {role.description && (
                          <div className="text-xs text-slate-500">{role.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={role.isSystem ? "neutral" : "accent"}>
                          {role.isSystem ? "System" : "Custom"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-secondary">{role.permissionKeys.length}</td>
                      <td className="px-4 py-3 text-secondary">{role.memberCount}</td>
                      <td className="px-4 py-3 text-right">
                        {!role.isSystem && (
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => openEditRole(role)}>
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setDeleteRoleTarget(role);
                                setDeleteRoleError(null);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "members" && (
        <div className="mt-6">
          <div className="flex items-start justify-between gap-4">
            <Input
              className="flex-1"
              placeholder="Search members…"
              value={memberSearch}
              onChange={(e) => {
                setMemberSearch(e.target.value);
                setMemberPage(1);
              }}
            />
            <Button type="button" onClick={openAddMember}>
              Add Member
            </Button>
          </div>

          {resetError && (
            <div role="alert" className="banner-error mt-4">
              {resetError}
            </div>
          )}

          {members === null ? (
            <p className="mt-4 text-sm text-slate-600">Loading…</p>
          ) : members.members.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No members found.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Name
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Email
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Department
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.members.map((member) => (
                    <tr key={member.id}>
                      <td className="px-4 py-3 font-medium text-primary">{member.fullName}</td>
                      <td className="px-4 py-3 text-slate-600">{member.email}</td>
                      <td className="px-4 py-3 text-slate-600">{member.roleName}</td>
                      <td className="px-4 py-3 text-slate-600">{member.departmentName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={member.accountStatus === "active" ? "success" : "accent"}>
                          {member.accountStatus}
                        </Badge>
                        {member.archived && (
                          <Badge variant="warning" className="ml-1">
                            Archived
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => openEditMember(member)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setResetTarget(member);
                              setResetError(null);
                            }}
                          >
                            Reset Password
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {members && (
            <Pagination
              className="mt-4"
              page={members.meta.page}
              pageSize={members.meta.pageSize}
              total={members.meta.total}
              onPageChange={setMemberPage}
            />
          )}
        </div>
      )}

      {tab === "forms" && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="field-label" htmlFor="form-type-select">
                Form
              </label>
              <select
                id="form-type-select"
                className="field-input"
                value={selectedFormKey ?? ""}
                onChange={(e) => setSelectedFormKey(e.target.value)}
              >
                {(formDefinitions ?? []).map((def) => (
                  <option key={def.key} value={def.key}>
                    {def.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" onClick={openCreateField} disabled={!selectedFormKey}>
              New Field
            </Button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            {formFields === null ? (
              <p className="p-4 text-sm text-slate-600">Loading…</p>
            ) : formFields.length === 0 ? (
              <p className="p-4 text-sm text-slate-600">This form has no fields yet.</p>
            ) : (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Label
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Scope
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Required
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {formFields.map((field) => (
                    <tr key={field.id}>
                      <td className="px-4 py-3 text-primary">{field.label}</td>
                      <td className="px-4 py-3 text-slate-600">{field.fieldType}</td>
                      <td className="px-4 py-3">
                        <Badge variant={field.scope === "tenant" ? "accent" : "neutral"}>{field.scope}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{field.isRequired ? "Yes" : "No"}</td>
                      <td className="px-4 py-3 text-right">
                        {field.scope === "tenant" && !field.isSystem && (
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => openEditField(field)}>
                              Edit
                            </Button>
                            <Button type="button" variant="outline" onClick={() => archiveField(field)}>
                              Archive
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title="Reset Password"
      >
        {resetTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This generates a new password for <strong>{resetTarget.fullName}</strong> and signs
              them out of any active session immediately. No email is sent — you&apos;ll need to
              share the new password with them yourself.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetTarget(null)}
                disabled={resetSubmitting}
              >
                Cancel
              </Button>
              <Button type="button" onClick={submitReset} isLoading={resetSubmitting}>
                Reset Password
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={resetResult !== null}
        onClose={() => {
          setResetResult(null);
          loadMembers();
        }}
        title="Password Reset"
      >
        {resetResult && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              New password for <strong>{resetResult.member.fullName}</strong>. This is shown only
              once — copy it now.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 font-mono text-sm text-primary">
              {resetResult.password}
            </div>
            <div className="flex items-center justify-end gap-3">
              {copyState === "failed" && (
                <span className="text-xs text-red-600">Couldn&apos;t copy — select the text above manually.</span>
              )}
              <Button
                type="button"
                onClick={async () => {
                  const succeeded = await copyToClipboard(resetResult.password);
                  setCopyState(succeeded ? "copied" : "failed");
                }}
              >
                {copyState === "copied" ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={addMemberOpen} onClose={() => setAddMemberOpen(false)} title="Add Member">
        <div className="space-y-4">
          {addMemberError && (
            <div role="alert" className="banner-error">
              {addMemberError}
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="add-member-full-name">
              Full name
            </label>
            <Input
              id="add-member-full-name"
              value={addMemberForm.fullName}
              onChange={(e) => setAddMemberForm((f) => ({ ...f, fullName: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="add-member-email">
              Email
            </label>
            <Input
              id="add-member-email"
              type="email"
              value={addMemberForm.email}
              onChange={(e) => setAddMemberForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="add-member-role">
              Role
            </label>
            {roles !== null && roles.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">This tenant has no roles yet.</p>
            ) : (
              <select
                id="add-member-role"
                className="field-input"
                value={addMemberForm.roleId}
                onChange={(e) => setAddMemberForm((f) => ({ ...f, roleId: e.target.value }))}
              >
                <option value="">{roles === null ? "Loading…" : "— Select a role —"}</option>
                {(roles ?? []).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="field-label" htmlFor="add-member-department">
              Department (optional)
            </label>
            <select
              id="add-member-department"
              className="field-input"
              value={addMemberForm.departmentId}
              onChange={(e) => setAddMemberForm((f) => ({ ...f, departmentId: e.target.value }))}
            >
              <option value="">— None —</option>
              {(departments ?? [])
                .filter((d) => d.status === "active")
                .map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddMemberOpen(false)}
              disabled={addMemberSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitAddMember}
              isLoading={addMemberSubmitting}
              disabled={
                !addMemberForm.fullName.trim() ||
                !addMemberForm.email.trim() ||
                !addMemberForm.roleId ||
                roles?.length === 0
              }
            >
              Add Member
            </Button>
          </div>
        </div>
      </Modal>

      {/* Spec 022 — Edit Member (reverses spec 020 FR-014) */}
      <Modal open={editMemberTarget !== null} onClose={() => setEditMemberTarget(null)} title="Edit Member">
        {editMemberTarget && (
          <div className="space-y-4">
            {editMemberError && (
              <div role="alert" className="banner-error">
                {editMemberError}
              </div>
            )}
            <div>
              <label className="field-label" htmlFor="edit-member-full-name">
                Full name
              </label>
              <Input
                id="edit-member-full-name"
                value={editMemberForm.fullName}
                onChange={(e) => setEditMemberForm((f) => ({ ...f, fullName: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="edit-member-role">
                Role
              </label>
              <select
                id="edit-member-role"
                className="field-input"
                value={editMemberForm.roleId}
                onChange={(e) => setEditMemberForm((f) => ({ ...f, roleId: e.target.value }))}
              >
                {(roles ?? []).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="edit-member-department">
                Department
              </label>
              <select
                id="edit-member-department"
                className="field-input"
                value={editMemberForm.departmentId}
                onChange={(e) => setEditMemberForm((f) => ({ ...f, departmentId: e.target.value }))}
              >
                <option value="">— None —</option>
                {(departments ?? [])
                  .filter((d) => d.status === "active")
                  .map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
              </select>
            </div>
            {editMemberFields === null ? (
              <p className="text-sm text-slate-600">Loading custom fields…</p>
            ) : (
              editMemberFields.filter((f) => !f.isSystem).map((field) => renderEditMemberCustomField(field))
            )}
            <label className="flex items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={editMemberForm.archived}
                onChange={(e) => setEditMemberForm((f) => ({ ...f, archived: e.target.checked }))}
              />
              Archived
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditMemberTarget(null)}
                disabled={editMemberSubmitting}
              >
                Cancel
              </Button>
              <Button type="button" onClick={submitEditMember} isLoading={editMemberSubmitting}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Spec 022 — Create/Edit Role */}
      <Modal
        open={roleModalOpen !== null}
        onClose={() => setRoleModalOpen(null)}
        title={roleModalOpen?.mode === "create" ? "New Role" : "Edit Role"}
      >
        <div className="space-y-4">
          {roleFormError && (
            <div role="alert" className="banner-error">
              {roleFormError}
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="role-name">
              Name
            </label>
            <Input
              id="role-name"
              value={roleForm.name}
              onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="role-description">
              Description (optional)
            </label>
            <Input
              id="role-description"
              value={roleForm.description}
              onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <div className="field-label">Permissions</div>
            {permissionCatalog === null ? (
              <p className="mt-1 text-sm text-slate-600">Loading…</p>
            ) : (
              <div className="mt-2 max-h-64 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
                {Array.from(groupedPermissions.entries()).map(([category, entries]) => (
                  <div key={category}>
                    <div className="text-xs font-medium uppercase text-slate-500">{category}</div>
                    <div className="mt-1 space-y-1">
                      {entries.map((entry) => (
                        <label key={entry.key} className="flex items-center gap-2 text-sm text-primary">
                          <input
                            type="checkbox"
                            checked={roleForm.permissionKeys.has(entry.key)}
                            onChange={() => togglePermission(entry.key)}
                          />
                          {entry.displayName}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRoleModalOpen(null)}
              disabled={roleFormSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitRoleForm}
              isLoading={roleFormSubmitting}
              disabled={!roleForm.name.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* Spec 022 — Delete Role */}
      <Modal open={deleteRoleTarget !== null} onClose={() => setDeleteRoleTarget(null)} title="Delete Role">
        {deleteRoleTarget && (
          <div className="space-y-4">
            {deleteRoleError && (
              <div role="alert" className="banner-error">
                {deleteRoleError}
              </div>
            )}
            <p className="text-sm text-slate-600">
              Delete <strong>{deleteRoleTarget.name}</strong>? This cannot be undone. If any member is
              still assigned to it, this will be rejected.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteRoleTarget(null)}
                disabled={deleteRoleSubmitting}
              >
                Cancel
              </Button>
              <Button type="button" onClick={submitDeleteRole} isLoading={deleteRoleSubmitting}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Spec 022 — Create/Edit Department */}
      <Modal
        open={departmentModalOpen !== null}
        onClose={() => setDepartmentModalOpen(null)}
        title={departmentModalOpen?.mode === "create" ? "New Department" : "Edit Department"}
      >
        <div className="space-y-4">
          {departmentFormError && (
            <div role="alert" className="banner-error">
              {departmentFormError}
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="department-name">
              Name
            </label>
            <Input
              id="department-name"
              value={departmentForm.name}
              onChange={(e) => setDepartmentForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="department-description">
              Description (optional)
            </label>
            <Input
              id="department-description"
              value={departmentForm.description}
              onChange={(e) => setDepartmentForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="department-parent">
              Parent department (optional)
            </label>
            <select
              id="department-parent"
              className="field-input"
              value={departmentForm.parentDepartmentId}
              onChange={(e) => setDepartmentForm((f) => ({ ...f, parentDepartmentId: e.target.value }))}
            >
              <option value="">— None —</option>
              {(departments ?? [])
                .filter((d) => d.id !== departmentModalOpen?.departmentId)
                .map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="department-status">
              Status
            </label>
            <select
              id="department-status"
              className="field-input"
              value={departmentForm.status}
              onChange={(e) =>
                setDepartmentForm((f) => ({ ...f, status: e.target.value as "active" | "archived" }))
              }
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="department-manager">
              Manager (optional)
            </label>
            <select
              id="department-manager"
              className="field-input"
              value={departmentForm.managerId}
              onChange={(e) => setDepartmentForm((f) => ({ ...f, managerId: e.target.value }))}
            >
              <option value="">— None —</option>
              {(members?.members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="department-assistant-manager">
              Assistant Manager (optional)
            </label>
            <select
              id="department-assistant-manager"
              className="field-input"
              value={departmentForm.assistantManagerId}
              onChange={(e) => setDepartmentForm((f) => ({ ...f, assistantManagerId: e.target.value }))}
            >
              <option value="">— None —</option>
              {(members?.members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDepartmentModalOpen(null)}
              disabled={departmentFormSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitDepartmentForm}
              isLoading={departmentFormSubmitting}
              disabled={!departmentForm.name.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* Spec 022 — Create/Edit Custom Field (Forms tab) */}
      <Modal
        open={fieldModalOpen !== null}
        onClose={() => setFieldModalOpen(null)}
        title={fieldModalOpen?.mode === "create" ? "New Field" : "Edit Field"}
      >
        <div className="space-y-4">
          {fieldFormError && (
            <div role="alert" className="banner-error">
              {fieldFormError}
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="field-label">
              Label
            </label>
            <Input
              id="field-label"
              value={fieldForm.label}
              onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          {fieldModalOpen?.mode === "create" && (
            <div>
              <label className="field-label" htmlFor="field-key">
                Field key (optional — derived from label if blank)
              </label>
              <Input
                id="field-key"
                value={fieldForm.fieldKey}
                onChange={(e) => setFieldForm((f) => ({ ...f, fieldKey: e.target.value }))}
              />
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="field-type">
              Type
            </label>
            <select
              id="field-type"
              className="field-input"
              value={fieldForm.fieldType}
              onChange={(e) => setFieldForm((f) => ({ ...f, fieldType: e.target.value as FieldType }))}
            >
              {FIELD_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {ft}
                </option>
              ))}
            </select>
          </div>
          {(fieldForm.fieldType === "select" || fieldForm.fieldType === "multiselect") && (
            <div>
              <label className="field-label" htmlFor="field-options">
                Options (comma-separated)
              </label>
              <Input
                id="field-options"
                value={fieldForm.options}
                onChange={(e) => setFieldForm((f) => ({ ...f, options: e.target.value }))}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-primary">
            <input
              type="checkbox"
              checked={fieldForm.isRequired}
              onChange={(e) => setFieldForm((f) => ({ ...f, isRequired: e.target.checked }))}
            />
            Required
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFieldModalOpen(null)}
              disabled={fieldFormSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitFieldForm}
              isLoading={fieldFormSubmitting}
              disabled={!fieldForm.label.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
