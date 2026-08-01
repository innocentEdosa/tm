"use client";

// Tenant Management spec — replaces "Provision Tenant" as the platform shell's tenant nav
// destination (spec FR-003). Single-file Client Component, matching this shell's own established
// convention (admin/permissions/page.tsx, provisioning/new/page.tsx) rather than the dashboard
// shell's server-page/client-component split — the platform shell's layout already gates on a
// binary Super Admin session with no per-page permission variance to resolve server-side.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import type { ApiResponse } from "@tm/types";
import { Badge, Button, Drawer, Input, Modal, Pagination } from "@tm/ui";

const API_BASE = "/platform-api";
const PAGE_SIZE = 25;
// Matches team-settings-client.tsx's own row-actions-menu convention (Team Member Directory spec) —
// a portal-positioned dropdown rather than a row of buttons, since a tenant row can show up to five
// actions at once (Super Admin Tenant Console spec added "Manage") and this shell's table has no
// room to spare.
const ROW_ACTIONS_MENU_WIDTH = 160;
const ROW_ACTIONS_MENU_HEIGHT = 210;

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

class UnauthenticatedError extends Error {}

function statusBadgeVariant(status: string): "success" | "accent" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "trial") return "accent";
  return "warning";
}

export default function TenantsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // Super Admin Tenant Console spec — server-side search, matching team-settings-client.tsx's own
  // debounce convention (300ms), since the Tenants list grows past a glance-able size once dozens
  // of tenants exist.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<TenantRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TenantRow | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["tenants", page, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`${API_BASE}/tenants?${params}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 401) throw new UnauthenticatedError();
      if (!res.ok) throw new Error("load-failed");
      const json = (await res.json()) as ApiResponse<ListData>;
      return json.data;
    },
    retry: false,
  });
  const isUnauthenticated = listQuery.error instanceof UnauthenticatedError;
  const isLoadError = listQuery.isError && !isUnauthenticated;
  const isLoading = listQuery.isPending;

  function reload() {
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
  }

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]);

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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/tenants/${confirmDelete!.id}/delete`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmTenantName: deleteConfirmInput }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) throw new Error(json.message ?? "Couldn't delete this tenant. Try again.");
    },
    onSuccess: () => {
      closeDeleteConfirm();
      reload();
    },
    onError: (err: Error) => setDeleteError(err.message || "Couldn't reach the server. Try again."),
  });

  function submitDelete() {
    if (!confirmDelete) return;
    setDeleteError(null);
    deleteMutation.mutate();
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

  const editMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: editForm!.name.trim(),
        industry: editForm!.industry.trim() || undefined,
        primaryContact: {
          name: editForm!.contactName.trim(),
          email: editForm!.contactEmail.trim(),
          phone: editForm!.contactPhone.trim() || undefined,
        },
      };
      if (editForm!.subdomain.trim() !== editingTenant!.subdomain) {
        payload.subdomain = editForm!.subdomain.trim();
      }
      const res = await fetch(`${API_BASE}/tenants/${editingTenant!.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) throw new Error(json.message ?? "Couldn't save changes. Try again.");
    },
    onSuccess: () => {
      closeEdit();
      reload();
    },
    onError: (err: Error) => setEditError(err.message || "Couldn't reach the server. Try again."),
  });

  function submitEdit() {
    if (!editingTenant || !editForm) return;
    setEditError(null);
    editMutation.mutate();
  }

  const actionMutation = useMutation({
    mutationFn: async ({ tenantId, action }: { tenantId: string; action: "archive" | "reactivate" | "downgrade" | "recover" }) => {
      const res = await fetch(`${API_BASE}/tenants/${tenantId}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) throw new Error(json.message ?? `Couldn't ${action} this tenant. Try again.`);
    },
    onSuccess: () => reload(),
    onError: (err: Error) => setActionError(err.message || "Couldn't reach the server. Try again."),
    onSettled: () => setActioningId(null),
  });

  function runAction(tenantId: string, action: "archive" | "reactivate" | "downgrade" | "recover") {
    setActioningId(tenantId);
    setActionError(null);
    actionMutation.mutate({ tenantId, action });
  }

  useEffect(() => {
    if (isUnauthenticated) {
      router.replace("/platform/login");
    }
  }, [isUnauthenticated, router]);

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

      <Input
        className="mt-6"
        placeholder="Search by company name, subdomain, or contact email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {(isLoading || isUnauthenticated) && (
        <p className="mt-8 text-sm text-slate-600">Loading…</p>
      )}

      {isLoadError && (
        <div role="alert" className="banner-error mt-8">
          Couldn&apos;t load tenants. Try again later.
        </div>
      )}

      {actionError && (
        <div role="alert" className="banner-error mt-6">
          {actionError}
        </div>
      )}

      {listQuery.data && (
        <>
          {listQuery.data.tenants.length === 0 ? (
            <p className="mt-8 text-sm text-slate-600">
              {debouncedSearch ? "No tenants match your search." : "No tenants yet."}
            </p>
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
                  {listQuery.data.tenants.map((tenant) => (
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
                          onManage={() => router.push(`/tenants/${tenant.id}`)}
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
            page={listQuery.data.meta.page}
            pageSize={listQuery.data.meta.pageSize}
            total={listQuery.data.meta.total}
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
              <Button type="button" variant="outline" onClick={closeEdit} disabled={editMutation.isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={submitEdit} isLoading={editMutation.isPending}>
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
              <Button type="button" variant="outline" onClick={closeDeleteConfirm} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submitDelete}
                isLoading={deleteMutation.isPending}
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
  onManage,
  onEdit,
  onArchive,
  onReactivate,
  onDowngrade,
  onDelete,
  onRecover,
}: {
  tenant: TenantRow;
  disabled: boolean;
  onManage: () => void;
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
              onClick={() => runAndClose(onManage)}
            >
              Manage
            </button>
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
