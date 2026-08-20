"use client";

// Full-screen create/edit, mirroring business-objective-form.tsx's own shape exactly (sticky header
// with Back/Cancel/Save, a single Card body) — replaces the previous Drawer-based
// tna-exercise-form-drawer.tsx. TNA exercises carry no tenant-configurable custom fields (unlike
// Department/Business Objective) — the exercise's own metadata (title/description/dates/targeting)
// is plain, hand-coded fields; only the participant *response* form (`tna_response`) is on the Form
// Builder — so this page has no `useEffectiveForm`/`FormRenderer` involvement, just the same page
// shell.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card, Button, Input, Toggle } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import TargetPicker, { type TargetRef } from "@/app/_shared/tna/target-picker";

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
  status: "draft" | "active" | "closed" | "under_review" | "committed";
}

interface FormState {
  title: string;
  description: string;
  endDate: string;
  targetsAllDepartments: boolean;
  departments: TargetRef[];
  roles: TargetRef[];
  users: TargetRef[];
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  endDate: "",
  targetsAllDepartments: false,
  departments: [],
  roles: [],
  users: [],
};

export default function TnaExerciseForm({ subdomain, exerciseId }: { subdomain: string; exerciseId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!exerciseId;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const entryQuery = useQuery({
    queryKey: ["tna-exercise", exerciseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: ExerciseDetail }>(`/tna-exercises/${exerciseId}`, { subdomain });
      return data;
    },
    enabled: isEditing,
    retry: false,
  });

  // For a `draft` exercise every field including targeting is editable — targets are a one-time
  // snapshot resolved at Start, so changing them after that would silently do nothing. Once an
  // exercise has left `draft` (active/closed/under_review), targeting locks: title/description/dates
  // remain editable (the backend PATCH route allows this in any non-`committed` status, e.g. to
  // extend a live deadline), but the targeting section is hidden entirely and never sent, so the
  // already-resolved roster in `tna_assignments` is never silently out of sync with what the form
  // implies.
  const targetsLocked = isEditing && entryQuery.data ? entryQuery.data.status !== "draft" : false;

  useEffect(() => {
    if (entryQuery.data) {
      const row = entryQuery.data;
      setForm({
        title: row.title,
        description: row.description ?? "",
        endDate: row.endDate,
        targetsAllDepartments: row.targetsAllDepartments,
        departments: row.targets.filter((t) => t.targetType === "department").map((t) => ({ id: t.departmentId!, name: t.departmentName! })),
        roles: row.targets.filter((t) => t.targetType === "role").map((t) => ({ id: t.roleId!, name: t.roleName! })),
        users: row.targets.filter((t) => t.targetType === "user").map((t) => ({ id: t.userId!, name: t.userName! })),
      });
    }
  }, [entryQuery.data]);

  useEffect(() => {
    if (entryQuery.error) setFormError((entryQuery.error as Error).message);
  }, [entryQuery.error]);

  const loading = isEditing && entryQuery.isPending;

  function backToList() {
    router.push("/strategy/training-needs-analysis");
  }

  function backToDetail() {
    router.push(isEditing ? `/strategy/training-needs-analysis/${exerciseId}` : "/strategy/training-needs-analysis");
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        endDate: form.endDate,
      };
      if (!targetsLocked) {
        body.targetsAllDepartments = form.targetsAllDepartments;
        body.targets = [
          ...form.departments.map((d) => ({ type: "department", departmentId: d.id })),
          ...form.roles.map((r) => ({ type: "role", roleId: r.id })),
          ...form.users.map((u) => ({ type: "user", userId: u.id })),
        ];
      }
      const path = isEditing ? `/tna-exercises/${exerciseId}` : "/tna-exercises";
      await tenantFetch(path, { method: isEditing ? "PATCH" : "POST", body, subdomain });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tna-exercises", subdomain] });
      queryClient.invalidateQueries({ queryKey: ["tna-exercise", exerciseId, subdomain] });
      router.push(
        isEditing ? `/strategy/training-needs-analysis/${exerciseId}?updated=1` : "/strategy/training-needs-analysis?created=1",
      );
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function handleSubmit() {
    setFormError(null);
    if (!form.title.trim()) return setFormError("Title is required.");
    if (!form.endDate) return setFormError("End date is required.");
    if (!targetsLocked && !form.targetsAllDepartments && form.departments.length === 0 && form.roles.length === 0 && form.users.length === 0) {
      return setFormError('Select at least one target department, role, or user — or toggle "All departments".');
    }
    saveMutation.mutate();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-white px-8 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary"
            onClick={backToDetail}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="shell-page-header-title text-xl">
            {targetsLocked ? "Edit dates" : isEditing ? "Edit TNA exercise" : "Create TNA exercise"}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={backToList}>
            Cancel
          </Button>
          <Button isLoading={saveMutation.isPending} onClick={handleSubmit}>
            {isEditing ? "Save changes" : "Create exercise"}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-8 py-8">
        <Card className="space-y-5 p-6">
          {formError && <div className="banner-error">{formError}</div>}
          {targetsLocked && (
            <p className="text-sm text-secondary">
              This exercise has already started, so its targeting can no longer change. You can still update the title, description,
              or dates — for example, to extend the deadline.
            </p>
          )}

          <Input label="Title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />

          <div>
            <label className="field-label" htmlFor="tna-description">
              Description
            </label>
            <textarea
              id="tna-description"
              className="field-input"
              rows={3}
              placeholder="Instructions for participants — what should this analysis cover?"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <Input
            label="Deadline"
            type="date"
            required
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
          />
          {!targetsLocked && (
            <p className="-mt-3 text-xs text-slate-500">
              There&apos;s no separate start date to configure — the exercise starts the moment HR clicks Start on its detail page, and
              that time is recorded automatically.
            </p>
          )}

          {!targetsLocked && (
            <>
              <div className="border-t border-border pt-2">
                <Toggle
                  checked={form.targetsAllDepartments}
                  onChange={(checked) => setForm((f) => ({ ...f, targetsAllDepartments: checked }))}
                  label="Target all departments"
                  description="Every active department's manager and assistant manager will be assigned."
                />
              </div>

              {!form.targetsAllDepartments && (
                <TargetPicker
                  subdomain={subdomain}
                  label="Target departments"
                  queryKey="tna-target-departments"
                  path="/departments"
                  nameOf={(d) => d.name as string}
                  selected={form.departments}
                  onChange={(next) => setForm((f) => ({ ...f, departments: next }))}
                  placeholder="Search departments…"
                />
              )}

              <TargetPicker
                subdomain={subdomain}
                label="Target roles (optional)"
                queryKey="tna-target-roles"
                path="/roles"
                nameOf={(r) => r.name as string}
                selected={form.roles}
                onChange={(next) => setForm((f) => ({ ...f, roles: next }))}
                placeholder="Search roles…"
              />

              <TargetPicker
                subdomain={subdomain}
                label="Target specific users (optional)"
                queryKey="tna-target-users"
                path="/users?pageSize=100"
                nameOf={(u) => `${u.fullName as string} (${u.email as string})`}
                selected={form.users}
                onChange={(next) => setForm((f) => ({ ...f, users: next }))}
                placeholder="Search users…"
              />
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
