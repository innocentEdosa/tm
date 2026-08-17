"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Drawer, Button, Input, Toggle } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import TargetPicker, { type TargetRef } from "./target-picker";

interface ExerciseTargetRow {
  targetType: "department" | "role" | "user";
  departmentId: string | null;
  departmentName: string | null;
  roleId: string | null;
  roleName: string | null;
  userId: string | null;
  userName: string | null;
}

export interface EditableExercise {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  targetsAllDepartments: boolean;
  targets: ExerciseTargetRow[];
}

interface FormState {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  targetsAllDepartments: boolean;
  departments: TargetRef[];
  roles: TargetRef[];
  users: TargetRef[];
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  startDate: "",
  endDate: "",
  targetsAllDepartments: false,
  departments: [],
  roles: [],
  users: [],
};

/** Create/edit — only ever opened for a `draft` exercise (targets are a one-time snapshot resolved
 * at Start, so editing them afterward would silently do nothing; the list/detail pages never offer
 * Edit once an exercise has left draft). */
export default function TnaExerciseFormDrawer({
  subdomain,
  open,
  onClose,
  exercise,
  onSaved,
}: {
  subdomain: string;
  open: boolean;
  onClose: () => void;
  exercise: EditableExercise | null;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!exercise;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (exercise) {
      setForm({
        title: exercise.title,
        description: exercise.description ?? "",
        startDate: exercise.startDate,
        endDate: exercise.endDate,
        targetsAllDepartments: exercise.targetsAllDepartments,
        departments: exercise.targets
          .filter((t) => t.targetType === "department")
          .map((t) => ({ id: t.departmentId!, name: t.departmentName! })),
        roles: exercise.targets
          .filter((t) => t.targetType === "role")
          .map((t) => ({ id: t.roleId!, name: t.roleName! })),
        users: exercise.targets
          .filter((t) => t.targetType === "user")
          .map((t) => ({ id: t.userId!, name: t.userName! })),
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setFormError(null);
  }, [open, exercise]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const targets = [
        ...form.departments.map((d) => ({ type: "department", departmentId: d.id })),
        ...form.roles.map((r) => ({ type: "role", roleId: r.id })),
        ...form.users.map((u) => ({ type: "user", userId: u.id })),
      ];
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate,
        targetsAllDepartments: form.targetsAllDepartments,
        targets,
      };
      const path = isEditing ? `/tna-exercises/${exercise!.id}` : "/tna-exercises";
      await tenantFetch(path, { method: isEditing ? "PATCH" : "POST", body, subdomain });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tna-exercises", subdomain] });
      onSaved();
      onClose();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function handleSubmit() {
    setFormError(null);
    if (!form.title.trim()) return setFormError("Title is required.");
    if (!form.startDate) return setFormError("Start date is required.");
    if (!form.endDate) return setFormError("End date is required.");
    if (form.startDate > form.endDate) return setFormError("End date must be on or after start date.");
    if (!form.targetsAllDepartments && form.departments.length === 0 && form.roles.length === 0 && form.users.length === 0) {
      return setFormError('Select at least one target department, role, or user — or toggle "All departments".');
    }
    saveMutation.mutate();
  }

  return (
    <Drawer open={open} onClose={onClose} side="right" title={isEditing ? "Edit TNA exercise" : "Create TNA exercise"}>
      <div className="space-y-4">
        {formError && <div className="banner-error">{formError}</div>}

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

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Start Date"
            type="date"
            required
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
          />
          <Input
            label="End Date"
            type="date"
            required
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
          />
        </div>

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

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={saveMutation.isPending} onClick={handleSubmit}>
            {isEditing ? "Save changes" : "Create exercise"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
