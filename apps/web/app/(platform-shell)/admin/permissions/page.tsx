"use client";

// Restyled to the locked design system (Role-Based Dashboard Shell spec's design-system/tm/MASTER.md)
// as part of the Super Admin Platform Dashboard Shell spec — presentation only; all fetch/state
// logic is unchanged from before this feature (research.md §6, FR-004). Kept as a Client Component
// (unlike the shell's Home page) since this page makes its own ongoing data fetches after the
// shell's layout has already confirmed a session — the unauthenticated/redirect handling here covers
// a session expiring *while already on this page*, not the initial load the layout already guards.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiResponse } from "@tm/types";

interface Permission {
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string;
}

interface RoleTemplate {
  id: string;
  key: string;
  name: string;
  description: string;
  isPlatformOnly: boolean;
  permissions: string[];
}

const API_BASE = "/platform-api";

type LoadState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; permissions: Permission[]; roleTemplates: RoleTemplate[] };

async function fetchJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const json = (await res.json()) as ApiResponse<T>;
  return { ok: true, data: json.data };
}

export default function AdminPermissionsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchJson<Permission[]>("/admin/permissions"),
      fetchJson<RoleTemplate[]>("/admin/role-templates"),
    ])
      .then(([permissionsResult, templatesResult]) => {
        if (cancelled) return;
        if (!permissionsResult.ok || !templatesResult.ok) {
          const status = !permissionsResult.ok ? permissionsResult.status : (templatesResult as { status: number }).status;
          setState(status === 401 ? { status: "unauthenticated" } : { status: "error" });
          return;
        }
        setState({
          status: "ready",
          permissions: permissionsResult.data,
          roleTemplates: templatesResult.data,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/platform/login");
    }
  }, [state.status, router]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-bold tracking-tight text-primary">
        Permissions &amp; Role Templates
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Platform-wide permission catalog and default role templates. Read-only.
      </p>

      {(state.status === "loading" || state.status === "unauthenticated") && (
        <p className="mt-8 text-sm text-slate-600">Loading…</p>
      )}

      {state.status === "error" && (
        <div role="alert" className="banner-error mt-8">
          Couldn&apos;t load permissions or role templates. Try again later.
        </div>
      )}

      {state.status === "ready" && (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-semibold text-primary">Permission Catalog</h2>
            {state.permissions.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                        Key
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                        Display Name
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                        Description
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                        Category
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {state.permissions.map((permission) => (
                      <tr key={permission.id}>
                        <td className="px-4 py-2 font-mono text-xs text-text">
                          {permission.key}
                        </td>
                        <td className="px-4 py-2 text-text">{permission.displayName}</td>
                        <td className="px-4 py-2 text-slate-600">{permission.description}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center rounded-full bg-cta/10 px-2 py-0.5 text-xs font-medium text-cta">
                            {permission.category}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">No permissions found.</p>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-primary">Role Templates</h2>
            {state.roleTemplates.length > 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {state.roleTemplates.map((template) => (
                  <div key={template.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-primary">{template.name}</h3>
                      {template.isPlatformOnly && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          Platform only
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{template.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {template.permissions.length > 0 ? (
                        template.permissions.map((key) => (
                          <span
                            key={key}
                            className="inline-flex items-center rounded-full bg-cta/10 px-2 py-0.5 font-mono text-xs text-cta"
                          >
                            {key}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">No permissions</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">No role templates found.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
