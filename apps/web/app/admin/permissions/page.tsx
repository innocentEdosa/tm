"use client";

// Follows the existing minimal, nascent conventions (Tailwind v4, @tm/ui palette/tokens) pending a
// fully locked design system — constitution Principle V, matching every other UI surface. Client
// component: guarded by `requireSuperAdminSession` (Super Admin Authentication spec), which reads
// the `tm_super_admin_session` cookie — a Server Component running on apps/web's own server has no
// access to that browser cookie, so this must fetch from the browser with `credentials: "include"`,
// same pattern as `app/platform/page.tsx`. Fetches go through next.config.ts's rewrite proxy
// (relative /platform-api/* path) so the cookie stays same-origin — see next.config.ts. Superseded
// the old dev-only `x-dev-user-id` header stub entirely — that mechanism is now actively rejected
// by the guard (research.md §4 of the Super Admin Authentication spec), not just unrelated to it.
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
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        Permissions &amp; Role Templates
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        Platform-wide permission catalog and default role templates. Read-only.
      </p>

      {(state.status === "loading" || state.status === "unauthenticated") && (
        <p className="mt-8 text-sm text-gray-600">Loading…</p>
      )}

      {state.status === "error" && (
        <div
          role="alert"
          className="mt-8 rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900"
        >
          Couldn&apos;t load permissions or role templates. Try again later.
        </div>
      )}

      {state.status === "ready" && (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-semibold text-gray-900">Permission Catalog</h2>
            {state.permissions.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                        Key
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                        Display Name
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                        Description
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                        Category
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {state.permissions.map((permission) => (
                      <tr key={permission.id}>
                        <td className="px-4 py-2 font-mono text-xs text-gray-900">
                          {permission.key}
                        </td>
                        <td className="px-4 py-2 text-gray-900">{permission.displayName}</td>
                        <td className="px-4 py-2 text-gray-600">{permission.description}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {permission.category}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-600">No permissions found.</p>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-gray-900">Role Templates</h2>
            {state.roleTemplates.length > 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {state.roleTemplates.map((template) => (
                  <div key={template.id} className="rounded-md border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-gray-900">{template.name}</h3>
                      {template.isPlatformOnly && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          Platform only
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{template.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {template.permissions.length > 0 ? (
                        template.permissions.map((key) => (
                          <span
                            key={key}
                            className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-700"
                          >
                            {key}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-gray-500">No permissions</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-600">No role templates found.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
