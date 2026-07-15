"use client";

// Tenant Management spec — replaces "Provision Tenant" as the platform shell's tenant nav
// destination (spec FR-003). Single-file Client Component, matching this shell's own established
// convention (admin/permissions/page.tsx, provisioning/new/page.tsx) rather than the dashboard
// shell's server-page/client-component split — the platform shell's layout already gates on a
// binary Super Admin session with no per-page permission variance to resolve server-side.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import type { ApiResponse } from "@tm/types";
import { Badge, Button, Drawer, Input, Modal, Pagination } from "@tm/ui";

const API_BASE = "/platform-api";
const PAGE_SIZE = 25;
// Matches team-settings-client.tsx's own row-actions-menu convention (Team Member Directory spec) —
// a portal-positioned dropdown rather than a row of buttons, since a tenant row can show up to four
// actions at once and this shell's table has no room to spare.
const ROW_ACTIONS_MENU_WIDTH = 160;
const ROW_ACTIONS_MENU_HEIGHT = 168;

interface TenantRow {
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

interface EditForm {
  name: string;
  industry: string;
  subdomain: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

function toEditForm(tenant: TenantRow): EditForm {
  return {
    name: tenant.name,
    industry: "",
    subdomain: tenant.subdomain,
    contactName: tenant.primaryContactName,
    contactEmail: tenant.primaryContactEmail,
    contactPhone: "",
  };
}

interface ListData {
  tenants: TenantRow[];
  meta: { page: number; pageSize: number; total: number };
}

type LoadState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; data: ListData };

function statusBadgeVariant(status: string): "success" | "accent" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "trial") return "accent";
  return "warning";
}

export default function TenantsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<TenantRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TenantRow | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  function openDeleteConfirm(tenant: TenantRow) {
    setConfirmDelete(tenant);
    setDeleteConfirmInput("");
    setDeleteError(null);
  }

  function closeDeleteConfirm() {
    setConfirmDelete(null);
    setDeleteConfirmInput("");
    setDeleteError(null);
  }

  async function submitDelete() {
    if (!confirmDelete) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`${API_BASE}/tenants/${confirmDelete.id}/delete`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmTenantName: deleteConfirmInput }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) {
        setDeleteError(json.message ?? "Couldn't delete this tenant. Try again.");
        return;
      }
      closeDeleteConfirm();
      reload();
    } catch {
      setDeleteError("Couldn't reach the server. Try again.");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function openEdit(tenant: TenantRow) {
    setEditingTenant(tenant);
    setEditForm(toEditForm(tenant));
    setEditError(null);
  }

  function closeEdit() {
    setEditingTenant(null);
    setEditForm(null);
    setEditError(null);
  }

  async function submitEdit() {
    if (!editingTenant || !editForm) return;
    setEditSubmitting(true);
    setEditError(null);

    const payload: Record<string, unknown> = {
      name: editForm.name.trim(),
      industry: editForm.industry.trim() || undefined,
      primaryContact: {
        name: editForm.contactName.trim(),
        email: editForm.contactEmail.trim(),
        phone: editForm.contactPhone.trim() || undefined,
      },
    };
    if (editForm.subdomain.trim() !== editingTenant.subdomain) {
      payload.subdomain = editForm.subdomain.trim();
    }

    try {
      const res = await fetch(`${API_BASE}/tenants/${editingTenant.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) {
        setEditError(json.message ?? "Couldn't save changes. Try again.");
        return;
      }
      closeEdit();
      reload();
    } catch {
      setEditError("Couldn't reach the server. Try again.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function runAction(tenantId: string, action: "archive" | "reactivate" | "downgrade" | "recover") {
    setActioningId(tenantId);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/tenants/${tenantId}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) {
        setActionError(json.message ?? `Couldn't ${action} this tenant. Try again.`);
        return;
      }
      reload();
    } catch {
      setActionError("Couldn't reach the server. Try again.");
    } finally {
      setActioningId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    fetch(`${API_BASE}/tenants?page=${page}&pageSize=${PAGE_SIZE}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthenticated" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as ApiResponse<ListData>;
        setState({ status: "ready", data: json.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [page, reloadToken]);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/platform/login");
    }
  }, [state.status, router]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Tenants</h1>
          <p className="mt-2 text-sm text-slate-600">
            Every company provisioned on TM. Edit, archive, downgrade, or delete a tenant from here.
          </p>
        </div>
        <Link href="/tenants/new">
          <Button type="button">Add Tenant</Button>
        </Link>
      </div>

      {(state.status === "loading" || state.status === "unauthenticated") && (
        <p className="mt-8 text-sm text-slate-600">Loading…</p>
      )}

      {state.status === "error" && (
        <div role="alert" className="banner-error mt-8">
          Couldn&apos;t load tenants. Try again later.
        </div>
      )}

      {actionError && (
        <div role="alert" className="banner-error mt-6">
          {actionError}
        </div>
      )}

      {state.status === "ready" && (
        <>
          {state.data.tenants.length === 0 ? (
            <p className="mt-8 text-sm text-slate-600">No tenants yet.</p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Company
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Subdomain
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Primary Contact
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Created
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {state.data.tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td className="px-4 py-3 font-medium text-text">{tenant.name}</td>
                      <td className="px-4 py-3 text-slate-600">{tenant.subdomain}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={statusBadgeVariant(tenant.status)}>{tenant.status}</Badge>
                          {tenant.isArchived && <Badge variant="warning">Archived</Badge>}
                          {tenant.isPendingDeletion && <Badge variant="warning">Pending Deletion</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{tenant.primaryContactName}</div>
                        <div className="text-xs text-slate-500">{tenant.primaryContactEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(tenant.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <TenantRowActionsMenu
                          tenant={tenant}
                          disabled={actioningId === tenant.id}
                          onEdit={() => openEdit(tenant)}
                          onArchive={() => setConfirmArchive(tenant)}
                          onReactivate={() => runAction(tenant.id, "reactivate")}
                          onDowngrade={() => runAction(tenant.id, "downgrade")}
                          onDelete={() => openDeleteConfirm(tenant)}
                          onRecover={() => runAction(tenant.id, "recover")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination
            className="mt-4"
            page={state.data.meta.page}
            pageSize={state.data.meta.pageSize}
            total={state.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}

      <Drawer open={editingTenant !== null} onClose={closeEdit} title="Edit Tenant">
        {editForm && (
          <div className="space-y-5">
            {editError && (
              <div role="alert" className="banner-error">
                {editError}
              </div>
            )}
            <div>
              <label htmlFor="edit-name" className="field-label">
                Company name
              </label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="edit-subdomain" className="field-label">
                Subdomain
              </label>
              <Input
                id="edit-subdomain"
                value={editForm.subdomain}
                onChange={(e) => setEditForm({ ...editForm, subdomain: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="edit-industry" className="field-label">
                Industry
              </label>
              <Input
                id="edit-industry"
                value={editForm.industry}
                onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
              />
            </div>
            <div className="border-t border-border pt-5">
              <h3 className="text-sm font-semibold text-primary">Primary contact</h3>
              <div className="mt-4 space-y-5">
                <div>
                  <label htmlFor="edit-contact-name" className="field-label">
                    Contact name
                  </label>
                  <Input
                    id="edit-contact-name"
                    value={editForm.contactName}
                    onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="edit-contact-email" className="field-label">
                    Contact email
                  </label>
                  <Input
                    id="edit-contact-email"
                    type="email"
                    value={editForm.contactEmail}
                    onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="edit-contact-phone" className="field-label">
                    Contact phone
                  </label>
                  <Input
                    id="edit-contact-phone"
                    type="tel"
                    value={editForm.contactPhone}
                    onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeEdit} disabled={editSubmitting}>
                Cancel
              </Button>
              <Button type="button" onClick={submitEdit} isLoading={editSubmitting}>
                Save changes
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={confirmArchive !== null} onClose={() => setConfirmArchive(null)} title="Archive Tenant">
        {confirmArchive && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Archiving <strong>{confirmArchive.name}</strong> immediately signs out its users and
              blocks access. Its data is preserved and this can be reversed at any time.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmArchive(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const tenant = confirmArchive;
                  setConfirmArchive(null);
                  runAction(tenant.id, "archive");
                }}
                isLoading={actioningId === confirmArchive.id}
              >
                Archive
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={confirmDelete !== null} onClose={closeDeleteConfirm} title="Delete Tenant">
        {confirmDelete && (
          <div className="space-y-4">
            {deleteError && (
              <div role="alert" className="banner-error">
                {deleteError}
              </div>
            )}
            <p className="text-sm text-slate-600">
              This immediately signs out <strong>{confirmDelete.name}</strong>&apos;s users and hides
              it from the Tenants list. It stays recoverable for a grace period, after which it and
              all of its data are permanently removed.
            </p>
            <div>
              <label htmlFor="delete-confirm-name" className="field-label">
                Type <strong>{confirmDelete.name}</strong> to confirm
              </label>
              <Input
                id="delete-confirm-name"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDeleteConfirm} disabled={deleteSubmitting}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submitDelete}
                isLoading={deleteSubmitting}
                disabled={deleteConfirmInput !== confirmDelete.name}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TenantRowActionsMenu({
  tenant,
  disabled,
  onEdit,
  onArchive,
  onReactivate,
  onDowngrade,
  onDelete,
  onRecover,
}: {
  tenant: TenantRow;
  disabled: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onReactivate: () => void;
  onDowngrade: () => void;
  onDelete: () => void;
  onRecover: () => void;
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

  function runAndClose(action: () => void) {
    setOpen(false);
    action();
  }

  const canDowngrade = tenant.status === "active" && !tenant.isArchived && !tenant.isPendingDeletion;

  return (
    <div data-row-actions>
      <button
        ref={buttonRef}
        type="button"
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Actions for ${tenant.name}`}
        onClick={toggleOpen}
        disabled={disabled}
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
              onClick={() => runAndClose(onEdit)}
            >
              Edit
            </button>
            {tenant.isArchived ? (
              <button
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                onClick={() => runAndClose(onReactivate)}
              >
                Reactivate
              </button>
            ) : (
              !tenant.isPendingDeletion && (
                <button
                  type="button"
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                  onClick={() => runAndClose(onArchive)}
                >
                  Archive
                </button>
              )
            )}
            {canDowngrade && (
              <button
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                onClick={() => runAndClose(onDowngrade)}
              >
                Downgrade
              </button>
            )}
            {tenant.isPendingDeletion ? (
              <button
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-secondary hover:bg-slate-50 hover:text-primary"
                onClick={() => runAndClose(onRecover)}
              >
                Recover
              </button>
            ) : (
              <button
                type="button"
                className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                onClick={() => runAndClose(onDelete)}
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
