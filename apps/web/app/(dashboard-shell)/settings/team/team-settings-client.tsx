"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button, Input, Card, Badge, PageHeader, Pagination, Drawer } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";
const TENANT_API_BASE = "/tenant-api/tenant";
const PAGE_SIZE = 25;

interface DepartmentOption {
  id: string;
  name: string;
  status: "active" | "archived";
}

interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  departmentName: string | null;
  accountStatus: "invited" | "active";
  invitedByName: string | null;
  invitedAt: string;
}

interface MemberListMeta {
  page: number;
  pageSize: number;
  total: number;
  reason: "no_department_assigned" | null;
}

interface MemberCustomField {
  id: string;
  fieldKey: string;
  label: string;
}

function MemberAvatar({ fullName }: { fullName: string }) {
  return <span className="shell-profile-avatar">{fullName.charAt(0).toUpperCase()}</span>;
}

// Mirrors Department's own established empty-state treatment (settings/department/department-settings-client.tsx) —
// a muted, descriptive placeholder rather than "—" for an unset value.
function FieldValue({ value, placeholder }: { value: React.ReactNode; placeholder: string }) {
  if (value === null || value === undefined || value === "") {
    return <p className="text-sm italic text-slate-400">{placeholder}</p>;
  }
  return <p className="text-sm text-secondary">{value}</p>;
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

const PROFILE_TABS = [
  { key: "profile", label: "Profile" },
  { key: "activity", label: "Activity" },
] as const;
type ProfileTabKey = (typeof PROFILE_TABS)[number]["key"];

export default function TeamSettingsClient({
  subdomain,
  canViewAll,
  canAddMember,
  canManageMembers,
}: {
  subdomain: string;
  canViewAll: boolean;
  canAddMember: boolean;
  canManageMembers: boolean;
}) {
  const [allDepartments, setAllDepartments] = useState<DepartmentOption[]>([]);
  const activeDepartmentOptions = allDepartments.filter((d) => d.status === "active");

  // Directory (spec 012, User Story 1)
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [page, setPage] = useState(1);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [meta, setMeta] = useState<MemberListMeta | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Profile drawer (spec 012, User Story 4) — the "member" form's custom fields are the same set
  // for every member, fetched once and reused; only the values are per-member and lazy-fetched when
  // a row is clicked (research.md §4/§7 — reuses the existing, already-generic Custom Fields
  // Framework routes, no new endpoint).
  const [viewTargetId, setViewTargetId] = useState<string | null>(null);
  const [memberFields, setMemberFields] = useState<MemberCustomField[] | null>(null);
  const [viewValues, setViewValues] = useState<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState<ProfileTabKey>("profile");

  // Add-member form (unchanged behavior — spec Assumptions/FR-018)
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch(`${TENANT_API_BASE}/departments?subdomain=${encodeURIComponent(subdomain)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json: { data: DepartmentOption[] }) => setAllDepartments(json.data))
      .catch(() => setAllDepartments([]));
  }, [subdomain]);

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

  function loadMembers() {
    const params = new URLSearchParams({
      subdomain,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (canViewAll && departmentFilter) params.set("departmentId", departmentFilter);

    fetch(`${TENANT_API_BASE}/team?${params.toString()}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load team members");
        return res.json();
      })
      .then((json: { data: MemberRow[]; meta: MemberListMeta }) => {
        setMembers(json.data);
        setMeta(json.meta);
        setListError(null);
      })
      .catch(() => setListError("Couldn't load team members. Try again."));
  }

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain, debouncedSearch, departmentFilter, page]);

  function openProfile(memberId: string) {
    setViewTargetId(memberId);
    setViewValues({});
    setActiveTab("profile");

    if (memberFields === null) {
      fetch(`${TENANT_API_BASE}/form-fields?formKey=member&subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((json: { data: MemberCustomField[] }) => setMemberFields(json.data))
        .catch(() => setMemberFields([]));
    }

    fetch(
      `${TENANT_API_BASE}/custom-field-values?formKey=member&entityId=${memberId}&subdomain=${encodeURIComponent(subdomain)}`,
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : { data: {} }))
      .then((json: { data: Record<string, unknown> }) => setViewValues(json.data))
      .catch(() => setViewValues({}));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/team?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, email, roleId, departmentId: departmentId || undefined }),
      });
      if (res.status === 201) {
        setMessage({ kind: "success", text: `Invitation sent to ${email}.` });
        setFullName("");
        setEmail("");
        setRoleId("");
        setDepartmentId("");
        setStatus("idle");
        loadMembers();
        return;
      }
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage({
        kind: "error",
        text: json?.message ?? "Couldn't add this team member. Try again.",
      });
      setStatus("error");
    } catch {
      setMessage({ kind: "error", text: "Couldn't reach the server. Try again." });
      setStatus("error");
    }
  }

  const descriptionLine = canViewAll
    ? "View and manage everyone in your organization."
    : "View and manage members of your department.";

  const viewTarget = viewTargetId ? (members ?? []).find((m) => m.id === viewTargetId) ?? null : null;

  return (
    <main className="px-8 py-8">
      <PageHeader title="Team Members" subtitle={descriptionLine} />

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
                    <Badge variant={member.accountStatus === "active" ? "success" : "warning"}>
                      {member.accountStatus === "active" ? "Active" : "Invited"}
                    </Badge>
                  </td>
                  {canManageMembers && (
                    <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <div
                          className="flex h-8 w-8 items-center justify-center text-slate-300"
                          title="Editing team members is coming soon"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </div>
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

      {canAddMember && (
        <>
          <h2 className="mt-10 text-xl font-semibold tracking-tight text-primary">Add a team member</h2>
          <p className="mt-1 text-sm text-slate-600">
            They&apos;ll receive an email with a one-time password to get started.
          </p>

          {message && (
            <div className={message.kind === "success" ? "banner-success mt-4" : "banner-error mt-4"}>
              {message.text}
            </div>
          )}

          <form className="surface-card mt-4 space-y-5" onSubmit={handleSubmit}>
            <Input
              label="Full name"
              id="fullName"
              name="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <Input
              label="Email"
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Role ID"
              id="roleId"
              name="roleId"
              required
              hint="The role's identifier, as assigned within your organization."
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            />
            <div>
              <label className="field-label" htmlFor="departmentId">
                Department
              </label>
              <select
                id="departmentId"
                name="departmentId"
                className="field-input"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">— None —</option>
                {activeDepartmentOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" isLoading={status === "loading"}>
              Add team member
            </Button>
          </form>
        </>
      )}

      <Drawer open={!!viewTarget} onClose={() => setViewTargetId(null)} side="right" title="Member profile">
        {viewTarget && (
          <div>
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <MemberAvatar fullName={viewTarget.fullName} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-primary">{viewTarget.fullName}</h3>
                  <Badge variant={viewTarget.accountStatus === "active" ? "success" : "warning"}>
                    {viewTarget.accountStatus === "active" ? "Active" : "Invited"}
                  </Badge>
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
                {(memberFields ?? []).map((field) => {
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
          </div>
        )}
      </Drawer>
    </main>
  );
}
