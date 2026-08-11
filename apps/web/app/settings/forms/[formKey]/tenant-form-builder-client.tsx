"use client";

// Form Builder spec (033) follow-up — Tenant Admin's own form builder, reached from a row on
// `/settings/forms`. Lives outside `(dashboard-shell)` (no AppShell chrome) — the SAME full-
// screen workspace shell as the Super Admin's Platform Forms builder
// (`app/platform/forms/[formId]/form-builder-client.tsx`), built from the SAME shared builder
// canvas/action-menu/CTA-editor components ("we should be using the same form builder as in the
// platform but working with respect to the tenant... the UI should be the same fullscreen
// builder") — no draft/versioning concept here (tenant changes apply immediately, so there's no
// "Versions" pane), but a Tenant Admin can now also create their OWN steps and sections (a new
// capability), scoped so they only ever affect this tenant's own rendering. A Tenant Admin can
// add/edit/archive their own tenant fields, hide/unhide optional platform fields, edit help text
// on system/platform fields, and set their own CTA wording — never touch a system/platform
// field's label, type, or placement, and never edit/delete a platform (non-tenant-owned) step or
// section.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Pencil } from "lucide-react";
import { Card, Drawer, Modal, Button, Input, Toggle } from "@tm/ui";
import { FormPreview, useEffectiveForm, type FormCta } from "@tm/form-builder";
import { FormBuilderCanvas, CtaEditor, FIELD_TYPE_LABELS, type FieldType, type CanvasAction, type CanvasBadge, type CanvasField, type CanvasSection, type CanvasStep } from "../../../_shared/form-builder";
import { AiPageContextProvider } from "../../../_shared/ai-assistant/ai-page-context";
import { AiAssistantLauncher } from "../../../_shared/ai-assistant/ai-assistant-launcher";

const API_BASE = "/tenant-api/tenant";

interface FormDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
}

interface FieldRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: string[] | null;
  isRequired: boolean;
  displayOrder: number;
  scope: "system" | "global" | "tenant";
  isSystem: boolean;
  isHidden: boolean;
  description: string | null;
  placeholder: string | null;
  sectionKey: string | null;
  sectionTitle: string | null;
  stepKey: string | null;
  stepTitle: string | null;
  needsReview: boolean;
}

interface StructureStep {
  id: string;
  key: string;
  title: string;
  description: string | null;
  isTenantOwned: boolean;
}
interface StructureSection {
  id: string;
  key: string;
  title: string;
  stepKey: string | null;
  isTenantOwned: boolean;
}
interface FormStructure {
  steps: StructureStep[];
  sections: StructureSection[];
}

const NO_SECTION_KEY = "__none__";

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface FieldFormState {
  label: string;
  fieldKey: string;
  fieldKeyTouched: boolean;
  fieldType: FieldType;
  options: string[];
  isRequired: boolean;
  sectionKey: string;
}

const EMPTY_FIELD_FORM: FieldFormState = {
  label: "",
  fieldKey: "",
  fieldKeyTouched: false,
  fieldType: "text",
  options: [],
  isRequired: false,
  sectionKey: "",
};

class ForbiddenError extends Error {}

export default function TenantFormBuilderClient({ formKey, subdomain }: { formKey: string; subdomain: string }) {
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FieldFormState>(EMPTY_FIELD_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const [helpTextField, setHelpTextField] = useState<FieldRow | null>(null);
  const [helpTextForm, setHelpTextForm] = useState({ description: "", placeholder: "" });
  const [helpTextError, setHelpTextError] = useState<string | null>(null);

  const [ctaEditorOpen, setCtaEditorOpen] = useState(false);
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaAlign, setCtaAlign] = useState<NonNullable<FormCta["align"]>>("right");
  const [ctaError, setCtaError] = useState<string | null>(null);

  const [structureError, setStructureError] = useState<string | null>(null);
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [stepForm, setStepForm] = useState({ title: "", description: "" });
  const [editingStep, setEditingStep] = useState<StructureStep | null>(null);
  const [confirmDeleteStep, setConfirmDeleteStep] = useState<StructureStep | null>(null);

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [sectionForm, setSectionForm] = useState({ title: "", stepKey: "" });
  const [editingSection, setEditingSection] = useState<StructureSection | null>(null);
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<StructureSection | null>(null);

  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  // Draggable divider between the builder canvas and the live preview pane — same mechanics as
  // the Platform Forms builder's own resizer.
  const [previewWidth, setPreviewWidth] = useState(400);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (!isResizingPreview) return;
    function onMouseMove(e: MouseEvent) {
      if (!resizeStartRef.current) return;
      const delta = e.clientX - resizeStartRef.current.x;
      const next = Math.min(720, Math.max(280, resizeStartRef.current.width - delta));
      setPreviewWidth(next);
    }
    function onMouseUp() {
      setIsResizingPreview(false);
      resizeStartRef.current = null;
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingPreview]);

  function startResizingPreview(e: React.MouseEvent) {
    e.preventDefault();
    resizeStartRef.current = { x: e.clientX, width: previewWidth };
    setIsResizingPreview(true);
  }

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
  const definition = definitionsQuery.data?.find((d) => d.key === formKey) ?? null;
  const accessError = definitionsQuery.error instanceof ForbiddenError ? "You don't have access to manage forms." : null;

  const fieldsQuery = useQuery({
    queryKey: ["form-fields", formKey, subdomain],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/form-fields?formKey=${encodeURIComponent(formKey)}&subdomain=${encodeURIComponent(subdomain)}`, {
        credentials: "include",
      });
      const json = (await res.json()) as { data: FieldRow[] };
      return json.data;
    },
  });
  const fields = fieldsQuery.data ?? null;

  const structureQuery = useQuery({
    queryKey: ["form-structure", formKey, subdomain],
    queryFn: async (): Promise<FormStructure> => {
      const res = await fetch(`${API_BASE}/forms/${formKey}/structure?subdomain=${encodeURIComponent(subdomain)}`, { credentials: "include" });
      const json = (await res.json()) as { data: FormStructure };
      return json.data;
    },
  });
  const structure = structureQuery.data ?? null;

  const fieldsBySectionKey = useMemo(() => {
    const map = new Map<string, FieldRow[]>();
    for (const f of fields ?? []) {
      const key = f.sectionKey ?? NO_SECTION_KEY;
      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    }
    return map;
  }, [fields]);

  const { form: previewForm } = useEffectiveForm(formKey, subdomain);

  useEffect(() => {
    setCtaLabel(previewForm?.cta?.label ?? "");
    setCtaAlign(previewForm?.cta?.align ?? "right");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewForm?.formVersionId]);

  function openCreate(sectionKey?: string) {
    setEditingId(null);
    setForm({ ...EMPTY_FIELD_FORM, sectionKey: sectionKey ?? "" });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(field: FieldRow) {
    setEditingId(field.id);
    setForm({
      label: field.label,
      fieldKey: field.fieldKey,
      fieldKeyTouched: true,
      fieldType: field.fieldType,
      options: field.options ?? [],
      isRequired: field.isRequired,
      sectionKey: field.sectionKey ?? "",
    });
    setFormError(null);
    setFormOpen(true);
  }

  const saveFieldMutation = useMutation({
    mutationFn: async () => {
      const trimmedLabel = form.label.trim();
      const fieldKey = form.fieldKey.trim() || slugify(trimmedLabel);
      const body = editingId
        ? { label: trimmedLabel, fieldType: form.fieldType, options: form.options.length > 0 ? form.options : null, isRequired: form.isRequired }
        : {
            label: trimmedLabel,
            fieldKey,
            fieldType: form.fieldType,
            options: form.options.length > 0 ? form.options : undefined,
            isRequired: form.isRequired,
            sectionKey: form.sectionKey || undefined,
          };
      const url = editingId
        ? `${API_BASE}/forms/${formKey}/fields/${editingId}?subdomain=${encodeURIComponent(subdomain)}`
        : `${API_BASE}/forms/${formKey}/fields?subdomain=${encodeURIComponent(subdomain)}`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this field. Try again.");
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const trimmedLabel = form.label.trim();
    if (!trimmedLabel) {
      setFormError("Label is required.");
      return;
    }
    if ((form.fieldType === "select" || form.fieldType === "multiselect" || form.fieldType === "radio") && form.options.length === 0) {
      setFormError("Add at least one option for select/multiselect/radio fields.");
      return;
    }
    const fieldKey = form.fieldKey.trim() || slugify(trimmedLabel);
    const collision = (fields ?? []).some((f) => f.id !== editingId && f.fieldKey === fieldKey);
    if (collision) {
      setFormError("A field with this key already exists on this form.");
      return;
    }
    saveFieldMutation.mutate();
  }

  const archiveMutation = useMutation({
    mutationFn: async (field: FieldRow) => {
      await fetch(`${API_BASE}/forms/${formKey}/fields/${field.id}?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
  });

  const toggleHiddenMutation = useMutation({
    mutationFn: async (field: FieldRow) => {
      const res = await fetch(`${API_BASE}/forms/${formKey}/fields/${field.id}/visibility?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden: !field.isHidden }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't change this field's visibility.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
  });

  function openEditHelpText(field: FieldRow) {
    setHelpTextField(field);
    setHelpTextForm({ description: field.description ?? "", placeholder: field.placeholder ?? "" });
    setHelpTextError(null);
  }

  const saveHelpTextMutation = useMutation({
    mutationFn: async () => {
      if (!helpTextField) return;
      const res = await fetch(`${API_BASE}/forms/${formKey}/fields/${helpTextField.id}/help-text?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: helpTextForm.description || null, placeholder: helpTextForm.placeholder || null }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this change.");
      }
    },
    onSuccess: () => {
      setHelpTextField(null);
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
    onError: (err: Error) => setHelpTextError(err.message),
  });

  const ctaMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/forms/${formKey}/cta?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: ctaLabel.trim() || null, align: ctaAlign }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this change.");
      }
    },
    onSuccess: () => {
      setCtaEditorOpen(false);
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
    onError: (err: Error) => setCtaError(err.message),
  });

  /** A field's `displayOrder` override only ever matters relative to its own section's siblings
   * (contracts/form-builder-api.md) — reordering within one section and sending just that
   * section's field ids is enough; unrelated sections are untouched. */
  const reorderMutation = useMutation({
    mutationFn: async (fieldIds: string[]) => {
      await fetch(`${API_BASE}/forms/${formKey}/fields/reorder?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldIds }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
  });

  // Form Builder follow-up: "we should be able to drag fields between steps" — moving a field to
  // a different section (any section, including one under a different step). Only ever allowed
  // for this tenant's own field: the section-change PATCH route only reaches a tenant-owned row
  // to begin with, so a system/platform field dropped on a different section is a silent no-op
  // (it would otherwise flash into the new spot and snap back once the request 404s).
  const moveFieldSectionMutation = useMutation({
    mutationFn: async ({ field, sectionKey }: { field: FieldRow; sectionKey: string }) => {
      const res = await fetch(`${API_BASE}/forms/${formKey}/fields/${field.id}?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionKey }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't move this field.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
    onError: (err: Error) => setStructureError(err.message),
  });

  function handleReorderField(targetSectionKey: string, draggedId: string, targetIndex: number) {
    const targetSectionFields = fieldsBySectionKey.get(targetSectionKey) ?? [];
    const sourceEntry = [...fieldsBySectionKey.entries()].find(([, fields]) => fields.some((f) => f.id === draggedId));
    if (!sourceEntry) return;
    const [sourceSectionKey, sourceSectionFields] = sourceEntry;
    const dragged = sourceSectionFields.find((f) => f.id === draggedId)!;

    if (sourceSectionKey === targetSectionKey) {
      const withoutDragged = targetSectionFields.filter((f) => f.id !== draggedId);
      const reordered = [...withoutDragged.slice(0, targetIndex), dragged, ...withoutDragged.slice(targetIndex)];
      reorderMutation.mutate(reordered.map((f) => f.id));
      return;
    }

    if (dragged.scope !== "tenant") return;

    const targetReordered = [...targetSectionFields.slice(0, targetIndex), dragged, ...targetSectionFields.slice(targetIndex)];
    moveFieldSectionMutation.mutate(
      { field: dragged, sectionKey: targetSectionKey },
      { onSuccess: () => reorderMutation.mutate(targetReordered.map((f) => f.id)) },
    );
  }

  function addOption() {
    setForm((f) => ({ ...f, options: [...f.options, ""] }));
  }
  function updateOption(index: number, value: string) {
    setForm((f) => ({ ...f, options: f.options.map((o, i) => (i === index ? value : o)) }));
  }
  function removeOption(index: number) {
    setForm((f) => ({ ...f, options: f.options.filter((_, i) => i !== index) }));
  }

  const showOptions = form.fieldType === "select" || form.fieldType === "multiselect" || form.fieldType === "radio";

  // Tenant-owned steps/sections — Form Builder spec follow-up: "the tenant can have sections and
  // steps too, it just only affects their tenant." Backend rejects any attempt to place a
  // section under a platform step, so the dropdown only ever offers this tenant's own steps.
  function openCreateStep() {
    setEditingStep(null);
    setStepForm({ title: "", description: "" });
    setStructureError(null);
    setStepModalOpen(true);
  }
  function openEditStep(step: StructureStep) {
    setEditingStep(step);
    setStepForm({ title: step.title, description: step.description ?? "" });
    setStructureError(null);
    setStepModalOpen(true);
  }

  const stepMutation = useMutation({
    mutationFn: async () => {
      const url = editingStep
        ? `${API_BASE}/forms/${formKey}/steps/${editingStep.id}?subdomain=${encodeURIComponent(subdomain)}`
        : `${API_BASE}/forms/${formKey}/steps?subdomain=${encodeURIComponent(subdomain)}`;
      const res = await fetch(url, {
        method: editingStep ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: stepForm.title.trim(), description: stepForm.description || null }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this step.");
      }

      // This tenant's very first own step makes their existing (previously step-less) sections
      // into "Step 1" — otherwise the new step would render above content with no step label of
      // its own, reading as though it belonged to the new step without actually being part of it
      // (Form Builder follow-up: "the existing form should become step one"). Only ever fires
      // once, and only ever touches this tenant's OWN no-step sections — a platform section's own
      // step placement is shared across every tenant and never something this action can move.
      if (!editingStep) {
        const isFirstTenantStep = !structureSteps.some((s) => s.isTenantOwned);
        if (isFirstTenantStep) {
          const created = (await res.json()) as { data: { key: string } };
          const ownNoStepSections = structureSections.filter((s) => s.isTenantOwned && s.stepKey === null);
          for (const section of ownNoStepSections) {
            await fetch(`${API_BASE}/forms/${formKey}/sections/${section.id}?subdomain=${encodeURIComponent(subdomain)}`, {
              method: "PATCH",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ stepKey: created.data.key }),
            });
          }
        }
      }
    },
    onSuccess: () => {
      setStepModalOpen(false);
      setEditingStep(null);
      queryClient.invalidateQueries({ queryKey: ["form-structure", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
    onError: (err: Error) => setStructureError(err.message),
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (step: StructureStep) => {
      const res = await fetch(`${API_BASE}/forms/${formKey}/steps/${step.id}?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't delete this step.");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["form-structure", formKey, subdomain] }),
    onError: (err: Error) => setStructureError(err.message),
  });

  function openCreateSection(stepKey?: string) {
    setEditingSection(null);
    setSectionForm({ title: "", stepKey: stepKey ?? "" });
    setStructureError(null);
    setSectionModalOpen(true);
  }
  function openEditSection(section: StructureSection) {
    setEditingSection(section);
    setSectionForm({ title: section.title, stepKey: section.stepKey ?? "" });
    setStructureError(null);
    setSectionModalOpen(true);
  }

  const sectionMutation = useMutation({
    mutationFn: async () => {
      const url = editingSection
        ? `${API_BASE}/forms/${formKey}/sections/${editingSection.id}?subdomain=${encodeURIComponent(subdomain)}`
        : `${API_BASE}/forms/${formKey}/sections?subdomain=${encodeURIComponent(subdomain)}`;
      const res = await fetch(url, {
        method: editingSection ? "PATCH" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: sectionForm.title.trim(), stepKey: sectionForm.stepKey || null }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this section.");
      }
    },
    onSuccess: () => {
      setSectionModalOpen(false);
      setEditingSection(null);
      queryClient.invalidateQueries({ queryKey: ["form-structure", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["form-fields", formKey, subdomain] });
      queryClient.invalidateQueries({ queryKey: ["effective-form", formKey, subdomain] });
    },
    onError: (err: Error) => setStructureError(err.message),
  });

  const deleteSectionMutation = useMutation({
    mutationFn: async (section: StructureSection) => {
      const res = await fetch(`${API_BASE}/forms/${formKey}/sections/${section.id}?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't delete this section.");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["form-structure", formKey, subdomain] }),
    onError: (err: Error) => setStructureError(err.message),
  });

  function toCanvasField(field: FieldRow): CanvasField {
    const canEdit = field.scope === "tenant";
    const canHide = field.scope === "global" && !field.isSystem && !field.isRequired;
    const canEditHelpText = field.scope === "system" || field.scope === "global";

    const badges: CanvasBadge[] = [];
    if (field.scope === "system") badges.push({ text: "System", variant: "neutral" });
    if (field.scope === "global") badges.push({ text: "Platform", variant: "neutral" });
    if (field.scope === "tenant") badges.push({ text: "Your field", variant: "accent" });
    if (field.isHidden) badges.push({ text: "Hidden", variant: "warning" });
    if (field.needsReview) badges.push({ text: "Needs review", variant: "warning" });

    const actions: CanvasAction[] = [];
    if (canEdit) actions.push({ label: "Edit", onClick: () => openEdit(field) });
    if (canEditHelpText) actions.push({ label: "Edit help text", onClick: () => openEditHelpText(field) });
    if (canHide) actions.push({ label: field.isHidden ? "Unhide" : "Hide", icon: field.isHidden ? Eye : EyeOff, onClick: () => toggleHiddenMutation.mutate(field) });
    if (canEdit) actions.push({ label: "Archive", destructive: true, onClick: () => archiveMutation.mutate(field) });

    return {
      id: field.id,
      label: field.label,
      isRequired: field.isRequired,
      typeLabel: FIELD_TYPE_LABELS[field.fieldType] ?? field.fieldType,
      badges,
      dimmed: field.isHidden,
      actions,
      draggable: true,
    };
  }

  function toCanvasSection(section: StructureSection): CanvasSection {
    const sectionFields = fieldsBySectionKey.get(section.key) ?? [];
    return {
      key: section.key,
      title: section.title,
      fields: sectionFields.map(toCanvasField),
      actions: section.isTenantOwned
        ? [
            { label: "Edit", onClick: () => openEditSection(section) },
            { label: "Delete", destructive: true, onClick: () => setConfirmDeleteSection(section) },
          ]
        : undefined,
      onAddField: () => openCreate(section.key),
    };
  }

  const structureSteps = structure?.steps ?? [];
  const structureSections = structure?.sections ?? [];
  const knownSectionKeys = new Set(structureSections.map((s) => s.key));
  const orphanFields = (fields ?? []).filter((f) => !f.sectionKey || !knownSectionKeys.has(f.sectionKey));

  const canvasSteps: CanvasStep[] = structureSteps.map((step) => ({
    key: step.key,
    title: step.title,
    sections: structureSections.filter((s) => s.stepKey === step.key).map(toCanvasSection),
    actions: step.isTenantOwned
      ? [
          { label: "Edit", onClick: () => openEditStep(step) },
          { label: "Delete", destructive: true, onClick: () => setConfirmDeleteStep(step) },
        ]
      : undefined,
    // A section can only ever nest under this tenant's OWN step (never a platform step, backend-
    // enforced) — so an empty *platform* step has no "+ Add section" shortcut here; use the
    // global "+ Add section" button and leave its step unset (a platform step's own sections come
    // from the platform version, not this tenant).
    onAddSection: step.isTenantOwned ? () => openCreateSection(step.key) : undefined,
  }));
  const canvasNoStepSections: CanvasSection[] = structureSections.filter((s) => s.stepKey === null).map(toCanvasSection);
  if (orphanFields.length > 0) {
    canvasNoStepSections.push({ key: NO_SECTION_KEY, title: "General", fields: orphanFields.map(toCanvasField), onAddField: () => openCreate() });
  }

  const hasAnyStructure = structureSteps.length > 0 || structureSections.length > 0 || orphanFields.length > 0;
  const isLoading = fields === null || structure === null;

  if (definitionsQuery.isLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
  }

  if (accessError || !definition) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-slate-500">{accessError ?? "This form couldn't be found."}</p>
        <Link href="/settings/forms" className="text-sm font-medium text-cta hover:underline">
          ← Back to Forms
        </Link>
      </div>
    );
  }

  return (
    <AiPageContextProvider value={{ formKey }}>
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/settings/forms" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
            <ArrowLeft className="h-4 w-4" />
            Back to Forms
          </Link>
          <div className="h-5 w-px bg-border" />
          <p className="text-sm font-semibold text-primary">{definition.name}</p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `minmax(0,1fr) 6px ${previewWidth}px` }}>
        {/* FORM BUILDER */}
        <main className="overflow-y-auto px-6 py-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Form Builder</p>
            <p className="text-xs text-slate-400">Changes here only affect your organization.</p>
          </div>
          {structureError && <div className="banner-error mb-4">{structureError}</div>}

          {isLoading ? (
            <Card className="p-8 text-center text-sm text-slate-500">Loading…</Card>
          ) : (
            <div className="space-y-6">
              <FormBuilderCanvas steps={canvasSteps} noStepSections={canvasNoStepSections} onReorderField={handleReorderField} />

              {!hasAnyStructure && <Card className="p-8 text-center text-sm text-slate-500">This form hasn&apos;t been published yet.</Card>}

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => openCreateSection()}>
                    + Add section
                  </Button>
                  <Button variant="secondary" onClick={openCreateStep}>
                    + Add step
                  </Button>
                </div>
                {!ctaEditorOpen && (
                  <Button variant="secondary" onClick={() => setCtaEditorOpen(true)}>
                    <Pencil className="mr-1.5 inline h-3.5 w-3.5" />
                    Edit CTA Button
                  </Button>
                )}
              </div>

              <CtaEditor
                label={ctaLabel}
                align={ctaAlign}
                onLabelChange={setCtaLabel}
                onAlignChange={setCtaAlign}
                onSave={() => ctaMutation.mutate()}
                isSaving={ctaMutation.isPending}
                error={ctaError}
                isOpen={ctaEditorOpen}
                onOpen={() => setCtaEditorOpen(true)}
                onClose={() => setCtaEditorOpen(false)}
              />
            </div>
          )}
        </main>

        {/* Drag handle — resizes the live preview pane */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize live preview panel"
          onMouseDown={startResizingPreview}
          className={`cursor-col-resize bg-border transition-colors hover:bg-slate-300 ${isResizingPreview ? "bg-slate-400" : ""}`}
        />

        {/* LIVE PREVIEW */}
        <aside className="overflow-y-auto border-l border-border bg-white px-6 py-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live Preview</p>
            <div className="flex rounded-md border border-border p-0.5 text-xs">
              <button
                type="button"
                className={`cursor-pointer rounded px-2.5 py-1 font-medium ${previewMode === "desktop" ? "bg-slate-100 text-primary" : "text-slate-400"}`}
                onClick={() => setPreviewMode("desktop")}
              >
                Desktop
              </button>
              <button
                type="button"
                className={`cursor-pointer rounded px-2.5 py-1 font-medium ${previewMode === "mobile" ? "bg-slate-100 text-primary" : "text-slate-400"}`}
                onClick={() => setPreviewMode("mobile")}
              >
                Mobile
              </button>
            </div>
          </div>
          <div className={previewMode === "mobile" ? "mx-auto max-w-[360px]" : "w-full"}>
            <Card className="p-6">
              {previewForm ? (
                <FormPreview key={previewForm.formVersionId ?? formKey} form={previewForm} subdomain={subdomain} />
              ) : (
                <p className="text-sm text-slate-400">Nothing to preview yet.</p>
              )}
            </Card>
          </div>
        </aside>
      </div>

      <Drawer open={formOpen} onClose={() => setFormOpen(false)} side="right" title={editingId ? "Edit field" : "Add field"}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {formError && <div className="banner-error">{formError}</div>}
          <Input
            label="Label"
            required
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value, fieldKey: f.fieldKeyTouched ? f.fieldKey : slugify(e.target.value) }))}
          />
          {!editingId && <Input label="Field key" value={form.fieldKey} onChange={(e) => setForm((f) => ({ ...f, fieldKey: e.target.value, fieldKeyTouched: true }))} />}
          <div>
            <label className="field-label" htmlFor="fieldType">
              Field type
            </label>
            <select id="fieldType" className="field-input" value={form.fieldType} onChange={(e) => setForm((f) => ({ ...f, fieldType: e.target.value as FieldType }))}>
              {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {!editingId && (
            <div>
              <label className="field-label" htmlFor="fieldSectionKey">
                Section
              </label>
              <select id="fieldSectionKey" className="field-input" value={form.sectionKey} onChange={(e) => setForm((f) => ({ ...f, sectionKey: e.target.value }))}>
                <option value="">{structureSections.length === 0 ? "General (created automatically)" : "— Select a section —"}</option>
                {structureSections.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          {showOptions && (
            <div>
              <p className="field-label">Options</p>
              <div className="space-y-2">
                {form.options.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <input className="field-input" value={option} onChange={(e) => updateOption(index, e.target.value)} />
                    <button type="button" className="cursor-pointer text-sm text-red-600" onClick={() => removeOption(index)}>
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" className="text-sm font-medium text-cta hover:underline cursor-pointer" onClick={addOption}>
                  + Add option
                </button>
              </div>
            </div>
          )}
          <Toggle label="Required" checked={form.isRequired} onChange={(checked) => setForm((f) => ({ ...f, isRequired: checked }))} />
          <Button type="submit" isLoading={saveFieldMutation.isPending} className="w-full">
            {editingId ? "Save changes" : "Add field"}
          </Button>
        </form>
      </Drawer>

      <Modal open={helpTextField !== null} onClose={() => setHelpTextField(null)} title="Edit help text">
        <div className="space-y-4">
          {helpTextError && <div className="banner-error">{helpTextError}</div>}
          {helpTextField && (
            <div>
              <p className="field-label">Label</p>
              <p className="text-sm text-secondary">{helpTextField.label}</p>
              <p className="mt-1 text-xs text-slate-400">
                {helpTextField.scope === "system" ? "A system field" : "A platform field"} — its label and type stay fixed; this is just your
                organization&apos;s own wording, and never affects any other tenant.
              </p>
            </div>
          )}
          <Input
            label="Description / help text"
            value={helpTextForm.description}
            onChange={(e) => setHelpTextForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Input label="Placeholder" value={helpTextForm.placeholder} onChange={(e) => setHelpTextForm((f) => ({ ...f, placeholder: e.target.value }))} />
          <Button className="w-full" isLoading={saveHelpTextMutation.isPending} onClick={() => saveHelpTextMutation.mutate()}>
            Save changes
          </Button>
        </div>
      </Modal>

      <Modal
        open={stepModalOpen}
        onClose={() => {
          setStepModalOpen(false);
          setEditingStep(null);
        }}
        title={editingStep ? "Edit step" : "Add step"}
      >
        <div className="space-y-4">
          {structureError && <div className="banner-error">{structureError}</div>}
          <Input label="Title" required value={stepForm.title} onChange={(e) => setStepForm((f) => ({ ...f, title: e.target.value }))} />
          <Input label="Description" value={stepForm.description} onChange={(e) => setStepForm((f) => ({ ...f, description: e.target.value }))} />
          <Button className="w-full" isLoading={stepMutation.isPending} disabled={!stepForm.title.trim()} onClick={() => stepMutation.mutate()}>
            {editingStep ? "Save changes" : "Add step"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={sectionModalOpen}
        onClose={() => {
          setSectionModalOpen(false);
          setEditingSection(null);
        }}
        title={editingSection ? "Edit section" : "Add section"}
      >
        <div className="space-y-4">
          {structureError && <div className="banner-error">{structureError}</div>}
          <Input
            label="Title"
            placeholder="Untitled section"
            value={sectionForm.title}
            onChange={(e) => setSectionForm((f) => ({ ...f, title: e.target.value }))}
          />
          {structureSteps.some((s) => s.isTenantOwned) && (
            <div>
              <label className="field-label" htmlFor="sectionStepKey">
                Step (optional)
              </label>
              <select id="sectionStepKey" className="field-input" value={sectionForm.stepKey} onChange={(e) => setSectionForm((f) => ({ ...f, stepKey: e.target.value }))}>
                <option value="">No step</option>
                {structureSteps
                  .filter((s) => s.isTenantOwned)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.title}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <Button className="w-full" isLoading={sectionMutation.isPending} disabled={!sectionForm.title.trim()} onClick={() => sectionMutation.mutate()}>
            {editingSection ? "Save changes" : "Add section"}
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDeleteSection !== null} onClose={() => setConfirmDeleteSection(null)} title="Delete this section?">
        <p className="mb-4">Move or archive its fields first. This cannot be undone.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            isLoading={deleteSectionMutation.isPending}
            onClick={() => {
              if (confirmDeleteSection) deleteSectionMutation.mutate(confirmDeleteSection);
              setConfirmDeleteSection(null);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onClick={() => setConfirmDeleteSection(null)}>
            Cancel
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDeleteStep !== null} onClose={() => setConfirmDeleteStep(null)} title="Delete this step?">
        <p className="mb-4">Delete its sections first. This cannot be undone.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            isLoading={deleteStepMutation.isPending}
            onClick={() => {
              if (confirmDeleteStep) deleteStepMutation.mutate(confirmDeleteStep);
              setConfirmDeleteStep(null);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onClick={() => setConfirmDeleteStep(null)}>
            Cancel
          </Button>
        </div>
      </Modal>

      <AiAssistantLauncher subdomain={subdomain} />
    </div>
    </AiPageContextProvider>
  );
}
