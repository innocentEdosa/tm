"use client";

// Restyled to the locked design system (Role-Based Dashboard Shell spec's design-system/tm/MASTER.md)
// as part of the Super Admin Platform Dashboard Shell spec — presentation only; all fetch/state
// logic is unchanged from before this feature (research.md §6, FR-004). Kept as a Client Component
// (unlike the shell's Home page) since this page makes its own ongoing data fetches after the
// shell's layout has already confirmed a session — the unauthenticated/redirect handling here covers
// a session expiring *while already on this page*, not the initial load the layout already guards.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ApiResponse } from "@tm/types";
import { Badge } from "@tm/ui";

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

class UnauthenticatedError extends Error {}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store" });
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error("load-failed");
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export default function AdminPermissionsPage() {
  const router = useRouter();
  const permissionsQuery = useQuery({
    queryKey: ["admin-permissions"],
    queryFn: () => fetchJson<Permission[]>("/admin/permissions"),
    retry: false,
  });
  const roleTemplatesQuery = useQuery({
    queryKey: ["admin-role-templates"],
    queryFn: () => fetchJson<RoleTemplate[]>("/admin/role-templates"),
    retry: false,
  });

  const isUnauthenticated =
    permissionsQuery.error instanceof UnauthenticatedError || roleTemplatesQuery.error instanceof UnauthenticatedError;
  const isError = (permissionsQuery.isError || roleTemplatesQuery.isError) && !isUnauthenticated;
  const isLoading = permissionsQuery.isPending || roleTemplatesQuery.isPending;

  useEffect(() => {
    if (isUnauthenticated) {
      router.replace("/platform/login");
    }
  }, [isUnauthenticated, router]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-bold tracking-tight text-primary">
        Permissions &amp; Role Templates
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Platform-wide permission catalog and default role templates. Read-only.
      </p>

      {(isLoading || isUnauthenticated) && (
        <p className="mt-8 text-sm text-slate-600">Loading…</p>
      )}

      {isError && (
        <div role="alert" className="banner-error mt-8">
          Couldn&apos;t load permissions or role templates. Try again later.
        </div>
      )}

      {!isLoading && !isUnauthenticated && !isError && permissionsQuery.data && roleTemplatesQuery.data && (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-semibold text-primary">Permission Catalog</h2>
            {permissionsQuery.data.length > 0 ? (
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
                    {permissionsQuery.data.map((permission) => (
                      <tr key={permission.id}>
                        <td className="px-4 py-2 font-mono text-xs text-text">
                          {permission.key}
                        </td>
                        <td className="px-4 py-2 text-text">{permission.displayName}</td>
                        <td className="px-4 py-2 text-slate-600">{permission.description}</td>
                        <td className="px-4 py-2">
                          <Badge variant="accent">{permission.category}</Badge>
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
            {roleTemplatesQuery.data.length > 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {roleTemplatesQuery.data.map((template) => (
                  <div key={template.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-primary">{template.name}</h3>
                      {template.isPlatformOnly && <Badge variant="neutral">Platform only</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{template.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {template.permissions.length > 0 ? (
                        template.permissions.map((key) => (
                          <Badge key={key} variant="accent" className="font-mono">
                            {key}
                          </Badge>
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
