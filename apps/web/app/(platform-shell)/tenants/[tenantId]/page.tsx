"use client";

// Super Admin Tenant Console spec — a read-focused, tenant-scoped console reached via the "Manage"
// row action on the Tenants list (tenants/page.tsx). Renders inside the Super Admin's own platform
// dashboard shell — never by navigating to the tenant's own subdomain (spec FR-002). Single-file
// Client Component, matching this shell's established convention (tenants/page.tsx,
// admin/permissions/page.tsx). No edit affordance for company/departments/roles anywhere on this
// page (spec FR-014) — the sole write action is the Members tab's password-reset button (FR-008).
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ApiResponse } from "@tm/types";
import { Badge, Button, Input, Modal, Pagination } from "@tm/ui";

const API_BASE = "/platform-api";
const PAGE_SIZE = 25;

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

interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  departmentName: string | null;
  accountStatus: "invited" | "active";
}

interface MembersData {
  members: MemberRow[];
  meta: { page: number; pageSize: number; total: number };
}

type Tab = "company" | "departments" | "roles" | "members";

const TABS: { id: Tab; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "departments", label: "Departments" },
  { id: "roles", label: "Roles" },
  { id: "members", label: "Members" },
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
 * hierarchy — the same visual idiom as the tenant-side department-settings-client.tsx, minus its
 * edit/collapse affordances (this view is read-only). */
function renderDepartmentRows(
  departments: DepartmentRow[],
  parentId: string | null,
  depth: number,
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
      </tr>
    );
    return [row, ...renderDepartmentRows(departments, dept.id, depth + 1)];
  });
}

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

  const [resetTarget, setResetTarget] = useState<MemberRow | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ member: MemberRow; password: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

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

  useEffect(() => {
    if (tab !== "departments" || departments !== null) return;
    fetch(`${API_BASE}/tenants/${tenantId}/departments`, { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((json: ApiResponse<DepartmentRow[]>) => setDepartments(json.data ?? []));
  }, [tab, tenantId, departments]);

  useEffect(() => {
    if (tab !== "roles" || roles !== null) return;
    fetch(`${API_BASE}/tenants/${tenantId}/roles`, { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((json: ApiResponse<RoleRow[]>) => setRoles(json.data ?? []));
  }, [tab, tenantId, roles]);

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
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
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
                </tr>
              </thead>
              <tbody>{renderDepartmentRows(departments, null, 0)}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === "roles" && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "members" && (
        <div className="mt-6">
          <Input
            placeholder="Search members…"
            value={memberSearch}
            onChange={(e) => {
              setMemberSearch(e.target.value);
              setMemberPage(1);
            }}
          />

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
                      </td>
                      <td className="px-4 py-3 text-right">
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
    </div>
  );
}
