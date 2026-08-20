"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card, Badge, Button, Drawer, Modal, Toast, type ToastVariant } from "@tm/ui";
import { useEffectiveForm } from "@tm/form-builder";
import { tenantFetch } from "@/lib/tenant-api-client";
import TargetPicker, { type TargetRef } from "@/app/_shared/tna/target-picker";

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

interface ExerciseTargetRow {
  targetType: "department" | "role" | "user";
  departmentId: string | null;
  departmentName: string | null;
  roleId: string | null;
  roleName: string | null;
  userId: string | null;
  userName: string | null;
}

interface ExerciseDetail {
  id: string;
  title: string;
  description: string | null;
  endDate: string;
  targetsAllDepartments: boolean;
  targets: ExerciseTargetRow[];
  status: ExerciseStatus;
  createdByName: string | null;
  startedAt: string | null;
  committedByName: string | null;
  committedAt: string | null;
  progress: { assigned: number; submitted: number; pending: number; completionPercent: number };
}

interface AssignmentRow {
  id: string;
  userName: string | null;
  userEmail: string | null;
  departmentName: string | null;
  sourceTargetType: string;
  status: "pending" | "submitted";
  submittedAt: string | null;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function isPastEndDate(endDate: string): boolean {
  return endDate < new Date().toISOString().slice(0, 10);
}

export default function TnaExerciseDetailClient({
  subdomain,
  exerciseId,
  canManage,
}: {
  subdomain: string;
  exerciseId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [viewingAssignmentId, setViewingAssignmentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [commitConfirmOpen, setCommitConfirmOpen] = useState(false);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [newParticipantUser, setNewParticipantUser] = useState<TargetRef[]>([]);
  const [newParticipantDepartment, setNewParticipantDepartment] = useState<TargetRef[]>([]);
  const [addParticipantError, setAddParticipantError] = useState<string | null>(null);
  const [removeAssignmentId, setRemoveAssignmentId] = useState<string | null>(null);

  const exerciseQuery = useQuery({
    queryKey: ["tna-exercise", exerciseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: ExerciseDetail }>(`/tna-exercises/${exerciseId}`, { subdomain });
      return data;
    },
  });
  const exercise = exerciseQuery.data;

  // One-shot success toast after redirecting back from the full-screen edit page
  // (tna-exercise-form.tsx), matching business-objectives-client.tsx's own pattern.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("updated") === "1") {
      setToast({ message: "TNA exercise updated.", variant: "success" });
      router.replace(`/strategy/training-needs-analysis/${exerciseId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assignmentsQuery = useQuery({
    queryKey: ["tna-exercise-assignments", exerciseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: AssignmentRow[] }>(`/tna-exercises/${exerciseId}/assignments`, { subdomain });
      return data;
    },
    enabled: !!exercise && exercise.status !== "draft",
  });
  const assignments = assignmentsQuery.data ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["tna-exercise", exerciseId, subdomain] });
    queryClient.invalidateQueries({ queryKey: ["tna-exercise-assignments", exerciseId, subdomain] });
    queryClient.invalidateQueries({ queryKey: ["tna-exercises", subdomain] });
  }

  const actionMutation = useMutation({
    mutationFn: async ({
      action,
      confirmDespitePending,
    }: {
      action: "start" | "close" | "reopen" | "begin-review" | "commit";
      confirmDespitePending?: boolean;
    }) => {
      await tenantFetch(`/tna-exercises/${exerciseId}/${action}`, {
        method: "POST",
        subdomain,
        body: action === "commit" ? { confirmDespitePending: !!confirmDespitePending } : undefined,
      });
    },
    onSuccess: (_data, { action }) => {
      setActionError(null);
      const messages: Record<string, string> = {
        start: "TNA started — assignments created.",
        close: "TNA closed.",
        reopen: "TNA reopened.",
        "begin-review": "TNA moved to review.",
        commit: "TNA committed.",
      };
      setToast({ message: messages[action], variant: "success" });
      invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  function handleCommitClick() {
    if ((exercise?.progress.pending ?? 0) > 0) {
      setCommitConfirmOpen(true);
    } else {
      actionMutation.mutate({ action: "commit" });
    }
  }

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await tenantFetch(`/tna-exercises/${exerciseId}`, { method: "DELETE", subdomain });
    },
    onSuccess: () => router.push("/strategy/training-needs-analysis"),
    onError: (err: Error) => setActionError(err.message),
  });

  const addParticipantMutation = useMutation({
    mutationFn: async () => {
      if (newParticipantUser.length === 0) throw new Error("Select a person to add.");
      await tenantFetch(`/tna-exercises/${exerciseId}/assignments`, {
        method: "POST",
        subdomain,
        body: { userId: newParticipantUser[0]!.id, departmentId: newParticipantDepartment[0]?.id ?? null },
      });
    },
    onSuccess: () => {
      setAddParticipantOpen(false);
      setNewParticipantUser([]);
      setNewParticipantDepartment([]);
      setAddParticipantError(null);
      setToast({ message: "Participant added.", variant: "success" });
      invalidate();
    },
    onError: (err: Error) => setAddParticipantError(err.message),
  });

  const removeAssignmentMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      await tenantFetch(`/tna-assignments/${assignmentId}`, { method: "DELETE", subdomain });
    },
    onSuccess: () => {
      setRemoveAssignmentId(null);
      setToast({ message: "Participant removed.", variant: "success" });
      invalidate();
    },
    onError: (err: Error) => {
      setRemoveAssignmentId(null);
      setActionError(err.message);
    },
  });

  if (exerciseQuery.isPending) {
    return (
      <main className="px-8 py-8">
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      </main>
    );
  }
  if (!exercise) {
    return (
      <main className="px-8 py-8">
        <div className="banner-error">This TNA exercise couldn&apos;t be found.</div>
      </main>
    );
  }

  const targetSummary = exercise.targetsAllDepartments
    ? "All departments"
    : exercise.targets.length === 0
      ? "No targets configured"
      : exercise.targets
          .map((t) => t.departmentName ?? t.roleName ?? t.userName)
          .filter(Boolean)
          .join(", ");

  return (
    <main className="px-8 py-8">
      <button
        type="button"
        className="mb-4 flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary"
        onClick={() => router.push("/strategy/training-needs-analysis")}
      >
        <ArrowLeft className="h-4 w-4" />
        Training Needs Analysis
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="shell-page-header-title text-xl">{exercise.title}</h1>
          <Badge variant={STATUS_BADGE[exercise.status]}>{STATUS_LABEL[exercise.status]}</Badge>
          {exercise.status === "active" && isPastEndDate(exercise.endDate) && <Badge variant="warning">Overdue</Badge>}
        </div>
        {canManage && (
          <div className="flex gap-2">
            {exercise.status === "draft" && (
              <>
                <Button variant="secondary" onClick={() => router.push(`/strategy/training-needs-analysis/${exerciseId}/edit`)}>
                  Edit
                </Button>
                <Button variant="secondary" onClick={() => setDeleteConfirmOpen(true)}>
                  Delete
                </Button>
                <Button isLoading={actionMutation.isPending} onClick={() => actionMutation.mutate({ action: "start" })}>
                  Start TNA
                </Button>
              </>
            )}
            {(exercise.status === "active" || exercise.status === "closed" || exercise.status === "under_review") && (
              <Button variant="secondary" onClick={() => router.push(`/strategy/training-needs-analysis/${exerciseId}/edit`)}>
                Edit dates
              </Button>
            )}
            {exercise.status === "active" && (
              <Button isLoading={actionMutation.isPending} onClick={() => actionMutation.mutate({ action: "close" })}>
                Close
              </Button>
            )}
            {exercise.status === "closed" && (
              <>
                <Button variant="secondary" isLoading={actionMutation.isPending} onClick={() => actionMutation.mutate({ action: "reopen" })}>
                  Reopen
                </Button>
                <Button isLoading={actionMutation.isPending} onClick={() => actionMutation.mutate({ action: "begin-review" })}>
                  Begin Review
                </Button>
              </>
            )}
            {exercise.status === "under_review" && (
              <Button isLoading={actionMutation.isPending} onClick={handleCommitClick}>
                Commit
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <div className="banner-error mt-4">{actionError}</div>}

      <Card className="mt-6 space-y-4 p-6">
        <h2 className="text-sm font-semibold text-primary">Overview</h2>
        {exercise.description && <p className="text-sm text-secondary">{exercise.description}</p>}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Started</p>
            <p className="mt-1 text-sm text-primary">
              {exercise.startedAt ? formatDate(exercise.startedAt.slice(0, 10)) : "Not started yet"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Deadline</p>
            <p className="mt-1 text-sm text-primary">{formatDate(exercise.endDate)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Targets</p>
            <p className="mt-1 truncate text-sm text-primary" title={targetSummary}>
              {targetSummary}
            </p>
          </div>
        </div>
        {exercise.committedByName && (
          <p className="text-xs text-slate-500">
            Committed by {exercise.committedByName} on {exercise.committedAt ? formatDate(exercise.committedAt.slice(0, 10)) : ""}
          </p>
        )}
      </Card>

      <Card className="mt-4 space-y-3 p-6">
        <h2 className="text-sm font-semibold text-primary">Progress</h2>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-2xl font-bold text-primary">{exercise.progress.assigned}</p>
            <p className="text-xs text-slate-500">Assigned</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary">{exercise.progress.submitted}</p>
            <p className="text-xs text-slate-500">Submitted</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary">{exercise.progress.pending}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary">{exercise.progress.completionPercent}%</p>
            <p className="text-xs text-slate-500">Completion</p>
          </div>
        </div>
      </Card>

      {exercise.status !== "draft" && (
        <Card className="mt-4 overflow-hidden p-0">
          <div className="flex items-center justify-between p-4">
            <h2 className="text-sm font-semibold text-primary">Responses</h2>
            {canManage && exercise.status !== "committed" && (
              <Button variant="secondary" onClick={() => setAddParticipantOpen(true)}>
                Add participant
              </Button>
            )}
          </div>
          {assignmentsQuery.isPending ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
          ) : assignments.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No participants were assigned.</div>
          ) : (
            <table className="w-full table-fixed divide-y divide-border text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Participant</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Department</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Submitted</th>
                  <th className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-600">Status</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-slate-50">
                    <td className="truncate px-4 py-3 text-sm text-primary" title={row.userName ?? ""}>
                      {row.userName ?? "—"}
                    </td>
                    <td className="truncate px-4 py-3 text-sm text-secondary">{row.departmentName ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">
                      {row.submittedAt ? formatDate(row.submittedAt.slice(0, 10)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={row.status === "submitted" ? "success" : "warning"}>
                        {row.status === "submitted" ? "Submitted" : "Pending"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      {row.status === "submitted" && (
                        <button
                          type="button"
                          className="cursor-pointer text-sm font-medium text-primary hover:underline"
                          onClick={() => setViewingAssignmentId(row.id)}
                        >
                          View
                        </button>
                      )}
                      {row.status === "pending" && canManage && exercise.status !== "committed" && (
                        <button
                          type="button"
                          className="cursor-pointer text-sm font-medium text-red-600 hover:underline"
                          onClick={() => setRemoveAssignmentId(row.id)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <ResponseViewDrawer
        subdomain={subdomain}
        exerciseId={exerciseId}
        assignmentId={viewingAssignmentId}
        onClose={() => setViewingAssignmentId(null)}
      />

      <Modal open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title={`Delete "${exercise.title}"?`}>
        <div className="space-y-4">
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to delete this draft TNA exercise?</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button isLoading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={commitConfirmOpen} onClose={() => setCommitConfirmOpen(false)} title="Commit with pending responses?">
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            {exercise.progress.pending} of {exercise.progress.assigned} assignment(s) are still pending. Committing finalizes this
            TNA — pending assignments will never be submittable afterward. This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCommitConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={actionMutation.isPending}
              onClick={() => {
                setCommitConfirmOpen(false);
                actionMutation.mutate({ action: "commit", confirmDespitePending: true });
              }}
            >
              Commit anyway
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={addParticipantOpen}
        onClose={() => {
          setAddParticipantOpen(false);
          setNewParticipantUser([]);
          setNewParticipantDepartment([]);
          setAddParticipantError(null);
        }}
        title="Add participant"
      >
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Manually add someone to this exercise&apos;s roster — for example, if a department&apos;s manager changed after Start, or
            someone was missed by the original targeting.
          </p>
          {addParticipantError && <div className="banner-error">{addParticipantError}</div>}
          <TargetPicker
            subdomain={subdomain}
            label="Person"
            queryKey="tna-add-participant-users"
            path="/users?pageSize=100"
            nameOf={(u) => `${u.fullName as string} (${u.email as string})`}
            selected={newParticipantUser}
            onChange={(next) => setNewParticipantUser(next.slice(-1))}
            placeholder="Search users…"
          />
          <TargetPicker
            subdomain={subdomain}
            label="Department context (optional)"
            queryKey="tna-add-participant-departments"
            path="/departments"
            nameOf={(d) => d.name as string}
            selected={newParticipantDepartment}
            onChange={(next) => setNewParticipantDepartment(next.slice(-1))}
            placeholder="Search departments…"
          />
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={() => setAddParticipantOpen(false)}>
              Cancel
            </Button>
            <Button isLoading={addParticipantMutation.isPending} onClick={() => addParticipantMutation.mutate()}>
              Add
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!removeAssignmentId} onClose={() => setRemoveAssignmentId(null)} title="Remove participant?">
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            They will no longer be part of this exercise&apos;s roster and won&apos;t be able to submit a response.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRemoveAssignmentId(null)}>
              Cancel
            </Button>
            <Button
              isLoading={removeAssignmentMutation.isPending}
              onClick={() => removeAssignmentId && removeAssignmentMutation.mutate(removeAssignmentId)}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </main>
  );
}

function ResponseViewDrawer({
  subdomain,
  exerciseId,
  assignmentId,
  onClose,
}: {
  subdomain: string;
  exerciseId: string;
  assignmentId: string | null;
  onClose: () => void;
}) {
  const { form: effectiveForm } = useEffectiveForm("tna_response", subdomain);

  const responseQuery = useQuery({
    queryKey: ["tna-response", exerciseId, assignmentId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: { userName: string | null; responseValues: Record<string, unknown> } }>(
        `/tna-exercises/${exerciseId}/assignments/${assignmentId}`,
        { subdomain },
      );
      return data;
    },
    enabled: !!assignmentId,
  });

  const fields = effectiveForm?.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields)) ?? [];

  return (
    <Drawer open={!!assignmentId} onClose={onClose} side="right" title={responseQuery.data?.userName ?? "Response"}>
      {responseQuery.isPending ? (
        <div className="p-4 text-center text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-4">
          {fields.map((field) => {
            const value = responseQuery.data?.responseValues[field.fieldKey];
            return (
              <div key={field.fieldKey}>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{field.label}</p>
                <p className="mt-1 text-sm text-primary whitespace-pre-wrap">
                  {value === undefined || value === null || value === "" ? "—" : String(value)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
