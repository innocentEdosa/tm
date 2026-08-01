"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, ChevronDown } from "lucide-react";
import { PageHeader, Card, Badge, Modal, Drawer, Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  isSystem: boolean;
  memberCount: number;
}

interface PermissionCatalogEntry {
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string;
}

interface RoleFormState {
  name: string;
  description: string;
  permissionKeys: Set<string>;
}

const EMPTY_FORM: RoleFormState = { name: "", description: "", permissionKeys: new Set() };

class ForbiddenError extends Error {}

const ROW_ACTIONS_MENU_WIDTH = 160;
const ROW_ACTIONS_MENU_HEIGHT = 84;

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
      // Portaled to <body> so the Card's `overflow-hidden` never clips this menu — same pattern
      // established for Department Management's own RowActionsMenu (Spec 009).
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow < ROW_ACTIONS_MENU_HEIGHT ? rect.top - ROW_ACTIONS_MENU_HEIGHT : rect.bottom + 4;
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
        aria-label="Role actions"
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

export default function RolesSettingsClient({ subdomain }: { subdomain: string }) {
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [form, setForm] = useState<RoleFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const [impactWarningTarget, setImpactWarningTarget] = useState<{ pendingSave: () => Promise<void>; memberCount: number } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<{ memberCount: number } | null>(null);

  const rolesQuery = useQuery({
    queryKey: ["roles", subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/roles?subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      if (res.status === 403) throw new ForbiddenError();
      const json = (await res.json()) as { data: RoleRow[] };
      return json.data;
    },
    retry: false,
  });
  const roles = rolesQuery.error instanceof ForbiddenError ? [] : (rolesQuery.data ?? null);
  const error = rolesQuery.error instanceof ForbiddenError ? "You don't have access to manage roles." : null;

  const catalogQuery = useQuery({
    queryKey: ["permission-catalog", subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/permission-catalog?subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data: PermissionCatalogEntry[] };
      return json.data;
    },
  });
  const catalog = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of catalog) {
      const list = groups.get(entry.category) ?? [];
      list.push(entry);
      groups.set(entry.category, list);
    }
    return Array.from(groups.entries()).map(([category, permissions]) => ({ category, permissions }));
  }, [catalog]);

  function toggleGroupCollapsed(category: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleSelectAllInGroup(category: string, permissions: PermissionCatalogEntry[]) {
    const allChecked = permissions.every((p) => form.permissionKeys.has(p.key));
    setForm((f) => {
      const next = new Set(f.permissionKeys);
      for (const p of permissions) {
        if (allChecked) next.delete(p.key);
        else next.add(p.key);
      }
      return { ...f, permissionKeys: next };
    });
  }

  function togglePermission(key: string) {
    setForm((f) => {
      const next = new Set(f.permissionKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...f, permissionKeys: next };
    });
  }

  function openCreate() {
    setEditingRole(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(role: RoleRow) {
    setEditingRole(role);
    setForm({ name: role.name, description: role.description ?? "", permissionKeys: new Set(role.permissionKeys) });
    setFormError(null);
    setFormOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        description: form.description || undefined,
        permissionKeys: Array.from(form.permissionKeys),
      };
      const url = editingRole
        ? `${API_BASE}/roles/${editingRole.id}?subdomain=${encodeURIComponent(subdomain)}`
        : `${API_BASE}/roles?subdomain=${encodeURIComponent(subdomain)}`;
      const res = await fetch(url, {
        method: editingRole ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this role. Try again.");
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      setImpactWarningTarget(null);
      queryClient.invalidateQueries({ queryKey: ["roles", subdomain] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  async function doSave() {
    await saveMutation.mutateAsync().catch(() => {});
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    const isDuplicate = (roles ?? []).some(
      (r) => r.id !== editingRole?.id && r.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (isDuplicate) {
      setFormError("A role with this name already exists.");
      return;
    }

    // spec FR-010/FR-011 — only editing (not creating) can affect existing members, and only when
    // the role currently has any assigned.
    if (editingRole && editingRole.memberCount > 0) {
      setImpactWarningTarget({ pendingSave: doSave, memberCount: editingRole.memberCount });
      return;
    }
    await doSave();
  }

  const deleteMutation = useMutation({
    mutationFn: async (role: RoleRow) => {
      const res = await fetch(`${API_BASE}/roles/${role.id}?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 409) {
        throw { conflict: true, memberCount: role.memberCount };
      }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteBlock(null);
      queryClient.invalidateQueries({ queryKey: ["roles", subdomain] });
    },
    onError: (err: { conflict?: boolean; memberCount?: number }) => {
      if (err?.conflict) setDeleteBlock({ memberCount: err.memberCount! });
    },
  });

  function handleDelete(role: RoleRow) {
    deleteMutation.mutate(role);
  }

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Roles"
          subtitle="Manage system roles and create custom roles with specific permissions."
        />
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Create role
        </Button>
      </div>

      {error && <div className="banner-error mb-4">{error}</div>}

      <Card className="p-0 overflow-hidden">
        {roles === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : roles.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No roles yet.</div>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Role name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Description</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Member count</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Type</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-t border-border">
                  <td className="px-4 py-3 text-sm text-primary">{role.name}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{role.description || "—"}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{role.memberCount}</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={role.isSystem ? "neutral" : "accent"}>
                      {role.isSystem ? "System" : "Custom"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <div className="flex justify-end">
                      {role.isSystem ? (
                        <div
                          className="flex h-8 w-8 items-center justify-center text-slate-300"
                          title="System roles cannot be modified"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </div>
                      ) : (
                        <RowActionsMenu
                          onEdit={() => openEdit(role)}
                          onDelete={() => {
                            setDeleteTarget(role);
                            setDeleteBlock(null);
                          }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        side="right"
        title={editingRole ? "Edit role" : "Create role"}
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          {formError && <div className="banner-error">{formError}</div>}
          <Input
            label="Role name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div>
            <label className="field-label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              className="field-input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div>
            <p className="field-label">Permissions</p>
            <div className="space-y-3">
              {groupedCatalog.map(({ category, permissions }) => {
                const collapsed = collapsedGroups.has(category);
                const allChecked = permissions.every((p) => form.permissionKeys.has(p.key));
                return (
                  <div key={category} className="rounded-lg border border-border">
                    <div className="flex items-center justify-between px-3 py-2">
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-2 text-sm font-medium text-primary"
                        onClick={() => toggleGroupCollapsed(category)}
                      >
                        <ChevronDown
                          className="h-4 w-4 transition-transform"
                          style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
                        />
                        {category}
                      </button>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-secondary">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={() => toggleSelectAllInGroup(category, permissions)}
                        />
                        Select all
                      </label>
                    </div>
                    {!collapsed && (
                      <div className="space-y-2 border-t border-border px-3 py-2">
                        {permissions.map((permission) => (
                          <label key={permission.id} className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={form.permissionKeys.has(permission.key)}
                              onChange={() => togglePermission(permission.key)}
                            />
                            <span>
                              <span className="block text-sm font-medium text-primary">{permission.displayName}</span>
                              <span className="block text-xs text-slate-500">{permission.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Button type="submit" isLoading={saveMutation.isPending} className="w-full">
            {editingRole ? "Save changes" : "Create role"}
          </Button>
        </form>
      </Drawer>

      <Modal
        open={!!impactWarningTarget}
        onClose={() => setImpactWarningTarget(null)}
        title="This change affects existing members"
      >
        {impactWarningTarget && (
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              This role is assigned to {impactWarningTarget.memberCount} member(s). Changes to its
              permissions will take effect for them immediately. Continue?
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImpactWarningTarget(null)}>
                Cancel
              </Button>
              <Button isLoading={saveMutation.isPending} onClick={() => impactWarningTarget.pendingSave()}>
                Continue
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
            <p className="text-sm text-secondary">
              This role is assigned to {deleteBlock.memberCount} member(s). Reassign them to a
              different role before deleting.
            </p>
            <a
              href={`/settings/team?role=${deleteTarget?.id ?? ""}`}
              className="text-sm font-medium text-cta hover:underline"
            >
              Go to Members →
            </a>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteBlock(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              This can&apos;t be undone. Are you sure you want to delete this role?
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
              <Button onClick={() => deleteTarget && handleDelete(deleteTarget)}>Delete</Button>
            </div>
          </div>
        )}
      </Modal>
    </main>
  );
}
