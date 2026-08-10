"use client";

// Form Builder spec (033) follow-up — Tenant Admin's "Settings > Forms" list, mirroring the
// Platform Forms list/detail split (apps/web/app/(platform-shell)/platform/forms/page.tsx +
// apps/web/app/platform/forms/[formId]/): this page is just the list; clicking a row opens the
// tenant-scoped builder at `/settings/forms/[formKey]`.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, Input, PageHeader } from "@tm/ui";

const API_BASE = "/tenant-api/tenant";

interface FormDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
}

class ForbiddenError extends Error {}

export default function FormsSettingsClient({ subdomain }: { subdomain: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const definitionsQuery = useQuery({
    queryKey: ["form-definitions", subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/form-definitions?subdomain=${encodeURIComponent(subdomain)}`, { credentials: "include" });
      if (res.status === 403) throw new ForbiddenError();
      const json = (await res.json()) as { data: FormDefinition[] };
      return json.data;
    },
    retry: false,
  });
  const definitions = definitionsQuery.error instanceof ForbiddenError ? [] : (definitionsQuery.data ?? null);
  const error = definitionsQuery.error instanceof ForbiddenError ? "You don't have access to manage forms." : null;

  const trimmedSearch = search.trim().toLowerCase();
  const filtered = definitions?.filter((d) => !trimmedSearch || d.name.toLowerCase().includes(trimmedSearch) || d.key.toLowerCase().includes(trimmedSearch)) ?? null;

  return (
    <main className="px-8 py-8">
      <PageHeader title="Forms" subtitle="Extend your organization's forms with your own fields, or hide ones you don't need." />

      {error && <div className="banner-error mt-4">{error}</div>}

      <Input placeholder="Search by name or key…" value={search} onChange={(e) => setSearch(e.target.value)} className="mt-6 max-w-sm" />

      <Card className="mt-4 overflow-hidden p-0">
        {filtered === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">{search ? "No forms match your search." : "No forms yet."}</div>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Key</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Description</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="cursor-pointer border-t border-border hover:bg-slate-50" onClick={() => router.push(`/settings/forms/${d.key}`)}>
                  <td className="px-4 py-3 text-sm font-medium text-primary">{d.name}</td>
                  <td className="px-4 py-3 text-sm text-secondary">
                    <code>{d.key}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary">{d.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
