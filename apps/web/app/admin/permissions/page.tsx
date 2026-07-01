// Follows the existing minimal, nascent conventions (Tailwind v4, @tm/ui palette/tokens) pending a
// fully locked design system — the constitution Principle V "flag a design-system proposal" for
// this screen; no new palette/font/component library introduced.
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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface FetchResult<T> {
  data: T[] | null;
  forbidden: boolean;
  error: boolean;
}

// DEV-ONLY: apps/api's server.ts has no real auth yet and stubs `request.user` from
// x-dev-user-id when NODE_ENV=development (never staging/production). Set DEV_SUPER_ADMIN_USER_ID
// locally to view this screen with real data. Delete once real auth ships.
const devHeaders: Record<string, string> =
  process.env.NODE_ENV === "development" && process.env.DEV_SUPER_ADMIN_USER_ID
    ? { "x-dev-user-id": process.env.DEV_SUPER_ADMIN_USER_ID }
    : {};

async function fetchAdmin<T>(path: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: devHeaders });
    if (res.status === 403) {
      return { data: null, forbidden: true, error: false };
    }
    if (!res.ok) {
      return { data: null, forbidden: false, error: true };
    }
    const json = (await res.json()) as ApiResponse<T[]>;
    return { data: json.data, forbidden: false, error: false };
  } catch {
    return { data: null, forbidden: false, error: true };
  }
}

export default async function AdminPermissionsPage() {
  const [permissionsResult, templatesResult] = await Promise.all([
    fetchAdmin<Permission>("/admin/permissions"),
    fetchAdmin<RoleTemplate>("/admin/role-templates"),
  ]);

  const forbidden = permissionsResult.forbidden || templatesResult.forbidden;
  const error = permissionsResult.error || templatesResult.error;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        Permissions &amp; Role Templates
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        Platform-wide permission catalog and default role templates. Read-only.
      </p>

      {forbidden && (
        <div
          role="alert"
          className="mt-8 rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900"
        >
          Forbidden — this view requires the platform Super Admin role.
        </div>
      )}

      {!forbidden && error && (
        <div
          role="alert"
          className="mt-8 rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900"
        >
          Couldn&apos;t load permissions or role templates. Try again later.
        </div>
      )}

      {!forbidden && !error && (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-semibold text-gray-900">Permission Catalog</h2>
            {permissionsResult.data && permissionsResult.data.length > 0 ? (
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
                    {permissionsResult.data.map((permission) => (
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
            {templatesResult.data && templatesResult.data.length > 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {templatesResult.data.map((template) => (
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
