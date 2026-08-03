"use client";

// Course Marketplace UI-reuse follow-up — a platform course has no direct learners of its own (only
// each tenant's *clone* does, once selected), so "Performance" here means adoption: how many tenants
// have selected this course, in what state, rather than the tenant course editor's learner-progress
// rollup. Backed by the same `GET /admin/marketplace-selections` the pending-requests queue uses,
// filtered to this one platform course and every status (not just `requested`).
import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@tm/ui";

const API_BASE = "/platform-api";

interface Selection {
  id: string;
  tenantId: string;
  tenantName: string;
  status: "requested" | "paid" | "rejected" | "fulfilled";
  requestedByName: string;
  requestedAt: string;
  resolvedAt: string | null;
  clonedCourseId: string | null;
}

const STATUS_BADGE_VARIANT: Record<Selection["status"], "success" | "warning" | "neutral" | "accent"> = {
  requested: "warning",
  paid: "accent",
  fulfilled: "success",
  rejected: "neutral",
};

export default function PlatformCoursePerformancePanel({ courseId }: { courseId: string }) {
  const selectionsQuery = useQuery({
    queryKey: ["platform-course-selections", courseId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/marketplace-selections?platformCourseId=${courseId}&status=all`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = (await res.json()) as { success: boolean; data?: Selection[]; message?: string };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.message ?? "Couldn't load adoption data.");
      }
      return json.data;
    },
  });

  if (selectionsQuery.isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (selectionsQuery.isError) {
    return <p className="banner-error">{(selectionsQuery.error as Error).message}</p>;
  }

  const selections = selectionsQuery.data ?? [];
  const fulfilledCount = selections.filter((s) => s.status === "fulfilled").length;
  const pendingCount = selections.filter((s) => s.status === "requested").length;

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">Performance</h2>
      <p className="mb-6 text-sm text-muted">How many tenants have selected this course, and where each selection stands.</p>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Tenants using this course</p>
          <p className="mt-1 text-2xl font-bold text-primary">{fulfilledCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Pending requests</p>
          <p className="mt-1 text-2xl font-bold text-primary">{pendingCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Total selections</p>
          <p className="mt-1 text-2xl font-bold text-primary">{selections.length}</p>
        </Card>
      </div>

      {selections.length === 0 ? (
        <p className="text-sm text-muted">No tenant has selected this course yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                  Tenant
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                  Requested by
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                  Requested
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                  Resolved
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {selections.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium text-text">{s.tenantName}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE_VARIANT[s.status]}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.requestedByName}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(s.requestedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-slate-600">{s.resolvedAt ? new Date(s.resolvedAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
