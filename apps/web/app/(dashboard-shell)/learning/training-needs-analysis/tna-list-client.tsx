"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader, Card, Badge, Button, Pagination, Toast, type ToastVariant } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import TnaExerciseFormDrawer from "./tna-exercise-form-drawer";

const DISPLAY_PAGE_SIZE = 10;

type ExerciseStatus = "draft" | "active" | "closed" | "under_review" | "committed";

const STATUS_LABEL: Record<ExerciseStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  under_review: "Under Review",
  committed: "Committed",
};
const STATUS_BADGE: Record<ExerciseStatus, "neutral" | "warning" | "success" | "accent"> = {
  draft: "neutral",
  active: "accent",
  closed: "warning",
  under_review: "warning",
  committed: "success",
};

interface ExerciseRow {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: ExerciseStatus;
  targetsAllDepartments: boolean;
  createdByName: string | null;
  progress: { assigned: number; submitted: number; pending: number; completionPercent: number };
}

interface MyAssignmentRow {
  id: string;
  status: "pending" | "submitted";
  departmentName: string | null;
  exerciseId: string;
  exerciseTitle: string;
  exerciseStatus: ExerciseStatus;
  startDate: string;
  endDate: string;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function TnaListClient({ subdomain, canManage, canView }: { subdomain: string; canManage: boolean; canView: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);

  const exercisesQuery = useQuery({
    queryKey: ["tna-exercises", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: ExerciseRow[] }>("/tna-exercises", { subdomain });
      return data;
    },
    enabled: canView,
  });
  const exercises = exercisesQuery.data ?? [];
  const paged = exercises.slice((page - 1) * DISPLAY_PAGE_SIZE, page * DISPLAY_PAGE_SIZE);

  const myAssignmentsQuery = useQuery({
    queryKey: ["my-tna-assignments", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: MyAssignmentRow[] }>("/my-tna-assignments", { subdomain });
      return data;
    },
  });
  const myAssignments = myAssignmentsQuery.data ?? [];

  return (
    <main className="px-8 py-8">
      <div className="flex items-start justify-between">
        <PageHeader title="Training Needs Analysis" subtitle="HR-initiated exercises to identify department training needs." />
        {canManage && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            Create TNA
          </Button>
        )}
      </div>

      {myAssignments.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-primary">My Training Needs Analysis</h2>
          <Card className="overflow-hidden p-0">
            <table className="w-full table-fixed divide-y divide-border text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">TNA</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Department</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Deadline</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Status</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {myAssignments.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-border hover:bg-slate-50"
                    onClick={() => router.push(`/learning/training-needs-analysis/my/${row.id}`)}
                  >
                    <td className="truncate px-4 py-3 text-sm font-medium text-primary" title={row.exerciseTitle}>
                      {row.exerciseTitle}
                    </td>
                    <td className="truncate px-4 py-3 text-sm text-secondary">{row.departmentName ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">{formatDate(row.endDate)}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={row.status === "submitted" ? "success" : "warning"}>
                        {row.status === "submitted" ? "Submitted" : "Pending"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-primary underline">
                      {row.status === "submitted" ? "View" : "Complete"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {canView && (
        <div className="mt-8">
          {exercises.length > 0 && <h2 className="mb-2 text-sm font-semibold text-primary">All Exercises</h2>}
          <Card className="overflow-hidden p-0">
            {exercisesQuery.isPending ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
            ) : exercises.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                {canManage ? "No TNA exercises yet — create your first one to get started." : "No TNA exercises yet."}
              </div>
            ) : (
              <table className="w-full table-fixed divide-y divide-border text-sm">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">TNA</th>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Start Date</th>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">End Date</th>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Participants</th>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Completion</th>
                    <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border hover:bg-slate-50"
                      onClick={() => router.push(`/learning/training-needs-analysis/${row.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="truncate text-sm font-medium text-primary" title={row.title}>
                          {row.title}
                        </div>
                        {row.targetsAllDepartments && <div className="text-xs text-slate-500">All departments</div>}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">{formatDate(row.startDate)}</td>
                      <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">{formatDate(row.endDate)}</td>
                      <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">
                        {row.progress.submitted} / {row.progress.assigned}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">{row.progress.completionPercent}%</td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {exercises.length > 0 && (
            <Pagination className="mt-3" page={page} pageSize={DISPLAY_PAGE_SIZE} total={exercises.length} onPageChange={setPage} />
          )}
        </div>
      )}

      {!canView && myAssignments.length === 0 && !myAssignmentsQuery.isPending && (
        <div className="mt-8 p-8 text-center text-sm text-slate-500">
          You have no Training Needs Analysis exercises to view or complete.
        </div>
      )}

      <TnaExerciseFormDrawer
        subdomain={subdomain}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        exercise={null}
        onSaved={() => {
          setToast({ message: "TNA exercise created.", variant: "success" });
          queryClient.invalidateQueries({ queryKey: ["tna-exercises", subdomain] });
        }}
      />

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </main>
  );
}
