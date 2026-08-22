"use client";

// Form Builder spec (033) — Platform Forms list. Moved from `/admin/forms` (which used to render
// the builder directly) to `/platform/forms`, mirroring this shell's own list/detail split
// elsewhere (tenants/page.tsx + tenants/[tenantId]/page.tsx, admin/course-marketplace/page.tsx +
// [courseId]/page.tsx) — the builder itself now lives at `/platform/forms/[formId]`. Server-side
// paginated + searchable (list-form-types.ts), matching list-tenants.ts's exact convention, since
// this list has the same "grows past a glance-able size" property once a Super Admin has created
// more than a handful of form types (spec FR-001 makes that unbounded).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { Badge, Button, Card, Input, Modal, PageHeader, Pagination, Popover, PopoverMenuItem } from "@tm/ui";

const API_BASE = "/platform-api";
const PAGE_SIZE = 25;
/** The "Create form" popover's own quick-jump list — deliberately not the same paginated query
 * as the main table (no page/search state to keep in sync with a floating panel); a single
 * larger page covers real usage, where non-test form types stay in the dozens, not thousands. */
const QUICK_LIST_SIZE = 50;

interface FormTypeRow {
  id: string;
  key: string;
  name: string;
  description: string;
  status: "active" | "archived";
  activeVersionId: string | null;
  createdAt: string;
}

interface ListData {
  forms: FormTypeRow[];
  meta: { page: number; pageSize: number; total: number };
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function PlatformFormsListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", key: "", keyTouched: false, description: "" });
  const [createError, setCreateError] = useState<string | null>(null);

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

  const formsQuery = useQuery({
    queryKey: ["platform-forms", page, debouncedSearch],
    queryFn: async (): Promise<ListData> => {
      // `builtInFirst` here too (not just the "Create form" popover below) — otherwise the
      // framework-shipped defaults (Department, TNA, Training Request, …) can get pushed off
      // page 1 by however many custom/test form types have since been created, ordered purely
      // by recency (spec FR-001 makes custom-type volume unbounded).
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), builtInFirst: "true" });
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const res = await fetch(`${API_BASE}/platform/forms?${qs.toString()}`, { credentials: "include" });
      const json = (await res.json()) as { data: ListData };
      return json.data;
    },
  });
  const forms = formsQuery.data?.forms ?? null;
  const meta = formsQuery.data?.meta ?? null;

  // Backs the "Create form" popover's quick-jump list — every existing form type, most recent
  // first, independent of the main table's own page/search state.
  const quickListQuery = useQuery({
    queryKey: ["platform-forms-quick-list"],
    queryFn: async (): Promise<FormTypeRow[]> => {
      const res = await fetch(`${API_BASE}/platform/forms?page=1&pageSize=${QUICK_LIST_SIZE}&builtInFirst=true`, { credentials: "include" });
      const json = (await res.json()) as { data: ListData };
      return json.data.forms;
    },
  });
  const quickList = quickListQuery.data ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/platform/forms`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: createForm.name.trim(), key: createForm.key.trim() || slugify(createForm.name), description: createForm.description.trim() }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't create this form.");
      }
      return (await res.json()) as { data: FormTypeRow };
    },
    onSuccess: ({ data }) => {
      setCreateOpen(false);
      setCreateForm({ name: "", key: "", keyTouched: false, description: "" });
      queryClient.invalidateQueries({ queryKey: ["platform-forms"] });
      queryClient.invalidateQueries({ queryKey: ["platform-forms-quick-list"] });
      router.push(`/platform/forms/${data.id}`);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader title="Platform Forms" subtitle="Build and publish forms every tenant can extend." />
        <Popover trigger={<Button>Create form</Button>} width={300} align="end">
          {(close) => (
            <>
              <div className="max-h-72 overflow-y-auto py-1">
                {quickList.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-400">No forms yet.</p>
                ) : (
                  quickList.map((f) => (
                    <PopoverMenuItem
                      key={f.id}
                      icon={<FileText className="h-4 w-4" />}
                      title={f.name}
                      onClick={() => {
                        close();
                        router.push(`/platform/forms/${f.id}`);
                      }}
                    />
                  ))
                )}
              </div>
              <PopoverMenuItem
                icon={<Plus className="h-4 w-4" />}
                title="Create a new form type"
                onClick={() => {
                  close();
                  setCreateOpen(true);
                }}
              />
            </>
          )}
        </Popover>
      </div>

      <Input
        placeholder="Search by name or key…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-6 max-w-sm"
      />

      <Card className="mt-4 overflow-hidden p-0">
        {forms === null ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : forms.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {search ? "No forms match your search." : "No forms yet — create the first one to get started."}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Key</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Version</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id} className="cursor-pointer border-t border-border hover:bg-slate-50" onClick={() => router.push(`/platform/forms/${f.id}`)}>
                  <td className="px-4 py-3 text-sm font-medium text-primary">{f.name}</td>
                  <td className="px-4 py-3 text-sm text-secondary">
                    <code>{f.key}</code>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={f.status === "active" ? "success" : "neutral"}>{f.status === "active" ? "Active" : "Archived"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary">{f.activeVersionId ? "Published" : "Not published"}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{new Date(f.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {meta && meta.total > 0 && <Pagination className="mt-3" page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create form">
        <div className="space-y-4">
          {createError && <div className="banner-error">{createError}</div>}
          <Input
            label="Name"
            required
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value, key: f.keyTouched ? f.key : slugify(e.target.value) }))}
          />
          <Input label="Key" value={createForm.key} onChange={(e) => setCreateForm((f) => ({ ...f, key: e.target.value, keyTouched: true }))} />
          <Input
            label="Description"
            required
            value={createForm.description}
            onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Button className="w-full" isLoading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Create
          </Button>
        </div>
      </Modal>
    </main>
  );
}
