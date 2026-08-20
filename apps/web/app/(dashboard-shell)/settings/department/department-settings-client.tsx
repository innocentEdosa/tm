"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { PageHeader, Card, Badge, Modal, Drawer, Button, Input, Toast, type ToastVariant } from "@tm/ui";
import { useEffectiveForm } from "@tm/form-builder";

const API_BASE = "/tenant-api/tenant";

interface UserRef {
  id: string;
  fullName: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  parentDepartmentId: string | null;
  memberCount: number;
  hasChildren: boolean;
  manager: UserRef | null;
  assistantManager: UserRef | null;
}

type DeleteBlock =
  | { reason: "has_members"; memberCount: number; message: string; membersListHref: string }
  | { reason: "has_children"; message: string };

/** A read-only detail value that's empty reads as a deliberate, described absence ("No manager
 * assigned") rather than a bare "—" — the same descriptive-fallback treatment "Parent department"
 * already used, extended here to every other detail field instead of living as a one-off. */
function FieldValue({ value, placeholder }: { value: React.ReactNode; placeholder: string }) {
  if (value === null || value === undefined || value === "") {
    return <p className="text-sm italic text-slate-400">{placeholder}</p>;
  }
  return <p className="text-sm text-secondary">{value}</p>;
}

interface RowActionsMenuProps {
  status: "active" | "archived";
  onEdit?: () => void;
  onArchiveToggle?: () => void;
  onDelete?: () => void;
}

const ROW_ACTIONS_MENU_WIDTH = 160;

class ForbiddenError extends Error {}

/** Every menu item is independently optional (`canEdit`/`canDelete`, resolved by the caller) — a
 * user holding only `department.view` (no create/edit/delete/manage) never sees an action that
 * would just 403 when clicked. */
function RowActionsMenu({ status, onEdit, onArchiveToggle, onDelete }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemCount = [onEdit, onArchiveToggle, onDelete].filter(Boolean).length;
  const menuHeight = itemCount * 36 + (onDelete && (onEdit || onArchiveToggle) ? 9 : 0) + 8;

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

  if (itemCount === 0) return null;

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
            {onEdit && (
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
            )}
            {onArchiveToggle && (
              <button
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                onClick={() => {
                  setOpen(false);
                  onArchiveToggle();
                }}
              >
                {status === "active" ? "Archive" : "Unarchive"}
              </button>
            )}
            {onDelete && (
              <>
                {(onEdit || onArchiveToggle) && <div className="my-1 border-t border-border" />}
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
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function DepartmentSettingsClient({
  subdomain,
  canCreate,
  canEdit,
  canDelete,
}: {
  subdomain: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [deleteTarget, setDeleteTarget] = useState<DepartmentRow | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<DeleteBlock | null>(null);

  const [viewTargetId, setViewTargetId] = useState<string | null>(null);
  const [viewCustomFieldValues, setViewCustomFieldValues] = useState<Record<string, unknown>>({});

  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(handle);
  }, [search]);

  // One-shot success toast after redirecting back from the full-screen create/edit page
  // (department-form.tsx), matching business-objectives-client.tsx's own pattern.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("created") === "1") {
      setToast({ message: "Department created.", variant: "success" });
      router.replace("/settings/department");
    } else if (params.get("updated") === "1") {
      setToast({ message: "Department updated.", variant: "success" });
      router.replace("/settings/department");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departmentsQuery = useQuery({
    queryKey: ["departments", subdomain, debouncedSearch],
    queryFn: async () => {
      const qs = new URLSearchParams({ subdomain });
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const res = await fetch(`${API_BASE}/departments?${qs.toString()}`, { credentials: "include" });
      if (res.status === 403) throw new ForbiddenError();
      const json = (await res.json()) as { data: DepartmentRow[] };
      return json.data;
    },
    retry: false,
  });
  const departments = useMemo(
    () => (departmentsQuery.error instanceof ForbiddenError ? [] : (departmentsQuery.data ?? null)),
    [departmentsQuery.error, departmentsQuery.data],
  );
  const error = departmentsQuery.error instanceof ForbiddenError ? "You don't have access to view departments." : null;

  function reloadDepartments() {
    queryClient.invalidateQueries({ queryKey: ["departments", subdomain] });
  }

  // Still needed here for the read-only View drawer's custom-field display — the create/edit form
  // itself (and its own `useEffectiveForm` call) now lives entirely in department-form.tsx.
  const { form: effectiveForm } = useEffectiveForm("department", subdomain);
  const layoutFields = useMemo(
    () => effectiveForm?.steps.flatMap((step) => step.sections.flatMap((section) => section.fields)) ?? [],
    [effectiveForm],
  );
  const customFields = useMemo(() => layoutFields.filter((f) => !f.isSystem), [layoutFields]);

  const viewCustomFieldValuesQuery = useQuery({
    queryKey: ["department-custom-field-values", viewTargetId, subdomain],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/custom-field-values?formKey=department&entityId=${viewTargetId}&subdomain=${encodeURIComponent(subdomain)}`,
        { credentials: "include" },
      );
      const json = (await res.json()) as { data: Record<string, unknown> };
      return json.data;
    },
    enabled: !!viewTargetId,
  });

  useEffect(() => {
    setViewCustomFieldValues(viewTargetId ? (viewCustomFieldValuesQuery.data ?? {}) : {});
  }, [viewTargetId, viewCustomFieldValuesQuery.data]);

  const byId = useMemo(() => new Map((departments ?? []).map((d) => [d.id, d])), [departments]);
  const viewTarget = viewTargetId ? (byId.get(viewTargetId) ?? null) : null;
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, DepartmentRow[]>();
    for (const dept of departments ?? []) {
      const key = dept.parentDepartmentId;
      const list = map.get(key) ?? [];
      list.push(dept);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [departments]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openView(dept: DepartmentRow) {
    setViewTargetId(dept.id);
  }

  const archiveToggleMutation = useMutation({
    mutationFn: async (dept: DepartmentRow) => {
      const nextStatus = dept.status === "active" ? "archived" : "active";
      await fetch(`${API_BASE}/departments/${dept.id}?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
    },
    onSuccess: () => reloadDepartments(),
  });

  function handleArchiveToggle(dept: DepartmentRow) {
    archiveToggleMutation.mutate(dept);
  }

  const deleteMutation = useMutation({
    mutationFn: async (target: DepartmentRow) => {
      const res = await fetch(
        `${API_BASE}/departments/${target.id}?subdomain=${encodeURIComponent(subdomain)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (res.status === 409) {
        const json = (await res.json()) as DeleteBlock;
        throw { block: json };
      }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteBlock(null);
      reloadDepartments();
    },
    onError: (err: { block?: DeleteBlock }) => {
      if (err?.block) setDeleteBlock(err.block);
    },
  });

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget);
  }

  function renderRows(parentId: string | null, depth: number): React.ReactNode[] {
    const rows = childrenByParent.get(parentId) ?? [];
    return rows.flatMap((dept) => {
      const isExpanded = expanded.has(dept.id);
      const row = (
        <tr
          key={dept.id}
          className="group cursor-pointer border-t border-border hover:bg-slate-50"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
            openView(dept);
          }}
        >
          <td className="px-4 py-3 text-sm text-primary">
            <span style={{ paddingLeft: `${depth * 20}px` }} className="flex items-center gap-2">
              {dept.hasChildren && (
                <button
                  type="button"
                  className="cursor-pointer text-slate-400 hover:text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleExpanded(dept.id);
                  }}
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              )}
              <span className="group-hover:text-cta group-hover:underline">{dept.name}</span>
            </span>
          </td>
          <td className="px-4 py-3 text-sm text-secondary">{dept.memberCount}</td>
          <td className="px-4 py-3 text-sm text-secondary">
            {byId.get(dept.parentDepartmentId ?? "")?.name ?? "—"}
          </td>
          <td className="px-4 py-3 text-sm">
            <Badge variant={dept.status === "active" ? "success" : "neutral"}>
              {dept.status === "active" ? "Active" : "Archived"}
            </Badge>
          </td>
          <td className="px-4 py-3 text-sm text-secondary">{dept.manager?.fullName ?? "—"}</td>
          {(canEdit || canDelete) && (
            <td className="px-4 py-3 text-right text-sm">
              <div className="flex justify-end">
                <RowActionsMenu
                  status={dept.status}
                  onEdit={canEdit ? () => router.push(`/settings/department/${dept.id}/edit`) : undefined}
                  onArchiveToggle={canEdit ? () => handleArchiveToggle(dept) : undefined}
                  onDelete={
                    canDelete
                      ? () => {
                          setDeleteTarget(dept);
                          setDeleteBlock(null);
                        }
                      : undefined
                  }
                />
              </div>
            </td>
          )}
        </tr>
      );
      const childRows = isExpanded ? renderRows(dept.id, depth + 1) : [];
      return [row, ...childRows];
    });
  }

  const topLevelCount = (childrenByParent.get(null) ?? []).length;

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Departments"
          subtitle="Organize your team into departments and sub-departments."
        />
        {canCreate && (
          <Button onClick={() => router.push("/settings/department/new")}>
            <Plus className="h-4 w-4" />
            Add department
          </Button>
        )}
      </div>

      <Input
        placeholder="Search departments…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      {error && <div className="banner-error mb-4">{error}</div>}

      <Card className="p-0 overflow-hidden">
        {departments === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : departments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {search
              ? "No departments match your search."
              : canCreate
                ? "No departments yet — create your first department to start organizing your team."
                : "No departments yet."}
          </div>
        ) : topLevelCount === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No departments match your search.</div>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Member count</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Parent department</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Manager</th>
                {(canEdit || canDelete) && <th className="px-4 py-2 text-right font-medium text-slate-600">Actions</th>}
              </tr>
            </thead>
            <tbody>{renderRows(null, 0)}</tbody>
          </table>
        )}
      </Card>

      <Drawer open={!!viewTarget} onClose={() => setViewTargetId(null)} side="right" title="Department details">
        {viewTarget && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-primary">{viewTarget.name}</h3>
              <Badge variant={viewTarget.status === "active" ? "success" : "neutral"}>
                {viewTarget.status === "active" ? "Active" : "Archived"}
              </Badge>
            </div>

            <div>
              <p className="field-label">Description</p>
              <FieldValue value={viewTarget.description} placeholder="No description added" />
            </div>

            <div>
              <p className="field-label">Parent department</p>
              <p className="text-sm text-secondary">
                {byId.get(viewTarget.parentDepartmentId ?? "")?.name ?? "Top-level (no parent)"}
              </p>
            </div>

            <div>
              <p className="field-label">Members</p>
              <p className="text-sm text-secondary">{viewTarget.memberCount}</p>
            </div>

            <div>
              <p className="field-label">Manager</p>
              <FieldValue value={viewTarget.manager?.fullName} placeholder="No manager assigned" />
            </div>

            <div>
              <p className="field-label">Assistant Manager</p>
              <FieldValue value={viewTarget.assistantManager?.fullName} placeholder="No assistant manager assigned" />
            </div>

            {customFields.map((field) => {
              const value = viewCustomFieldValues[field.fieldKey];
              const display = Array.isArray(value) ? value.join(", ") : (value as string | number | undefined);
              return (
                <div key={field.id}>
                  <p className="field-label">{field.label}</p>
                  <FieldValue value={display} placeholder="Not set" />
                </div>
              );
            })}

            {(childrenByParent.get(viewTarget.id) ?? []).length > 0 && (
              <div>
                <p className="field-label">Sub-departments</p>
                <ul className="space-y-1">
                  {(childrenByParent.get(viewTarget.id) ?? []).map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className="cursor-pointer text-sm text-cta hover:underline"
                        onClick={() => openView(child)}
                      >
                        {child.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canEdit && (
              <Button onClick={() => router.push(`/settings/department/${viewTarget.id}/edit`)} className="w-full">
                Edit department
              </Button>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteBlock(null);
        }}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
      >
        {deleteBlock ? (
          <div className="space-y-4">
            <p className="text-sm text-secondary">{deleteBlock.message}</p>
            {deleteBlock.reason === "has_members" && (
              <a href={deleteBlock.membersListHref} className="text-sm font-medium text-cta hover:underline">
                Go to Members →
              </a>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteBlock(null);
                }}
              >
                Cancel
              </Button>
              {deleteTarget && canEdit && (
                <Button onClick={() => handleArchiveToggle(deleteTarget)}>Archive instead</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              This can&apos;t be undone. Are you sure you want to delete this department?
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteBlock(null);
                }}
              >
                Cancel
              </Button>
              <Button isLoading={deleteMutation.isPending} onClick={handleDeleteConfirm}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </main>
  );
}
