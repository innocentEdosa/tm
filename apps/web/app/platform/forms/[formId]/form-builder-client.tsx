"use client";

// Form Builder spec (033) — full-screen builder workspace, reached from a row (or the "Create
// form" popover) on `/platform/forms`. Lives outside the `(platform-shell)` route group (mirrors
// `/platform/login`'s own precedent for a top-level, chrome-free `/platform/*` page) so the
// three-pane workspace (versions / builder canvas / live preview) gets the full viewport instead
// of competing with the persistent AppShell sidebar for width.
//
// The left pane lists this form type's own versions (draft + published/archived history) rather
// than a switcher across form types — selecting a historical version renders it read-only in the
// same canvas/preview (published/archived versions are immutable, contracts/form-builder-api.md),
// while the draft (if any) stays the one editable entry.
//
// Step/section reordering here uses simple up/down buttons rather than a `@dnd-kit` drag surface
// (research.md §2's precedent, `curriculum-tab.tsx`, remains the reference implementation for a
// full drag canvas — a documented follow-up, not required for steps/sections to be genuinely
// addable, renameable, and orderable, which is what spec FR-017/FR-018 actually require).
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { Card, Badge, Drawer, Modal, Button, Input, Toggle } from "@tm/ui";
import { FormPreview, type EffectiveForm, type FormField as RendererField } from "@tm/form-builder";
import { FormBuilderCanvas, CtaEditor, FIELD_TYPE_LABELS, type FieldType, type CanvasAction, type CanvasField, type CanvasSection, type CanvasStep } from "../../../_shared/form-builder";

const API_BASE = "/platform-api";

interface FormTypeRow {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  status: "active" | "archived";
  activeVersionId: string | null;
}

interface VersionSummary {
  id: string;
  versionNumber: number;
  status: "draft" | "published" | "archived";
  publishedAt: string | null;
}

interface ExpandedField {
  id: string;
  sectionKey: string;
  fieldKey: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  fieldType: string;
  options: string[] | null;
  isRequired: boolean;
  displayOrder: number;
  layout: { colSpan?: number } | null;
  /** A placeholder for the consuming module's own hardcoded field (e.g. Department's Name) —
   * locked in this builder (spec: "System field ... never editable through the Form Builder").
   * The server is the actual enforcement point (`replaceDraftStructure` ignores any attempt to
   * touch these regardless of what's sent); this flag only drives the UI lock. */
  isSystem: boolean;
}
interface ExpandedSection {
  id: string;
  stepKey: string | null;
  key: string;
  title: string;
  description: string | null;
  displayOrder: number;
  fields: ExpandedField[];
}
interface ExpandedStep {
  id: string;
  key: string;
  title: string;
  description: string | null;
  displayOrder: number;
  isOptional: boolean;
  sections: ExpandedSection[];
}
interface FormCta {
  label?: string;
  align?: "left" | "center" | "right" | "full";
}
interface ExpandedVersion {
  id: string;
  versionNumber: number;
  status: "draft" | "published" | "archived";
  publishedAt: string | null;
  steps: ExpandedStep[];
  sections: ExpandedSection[];
  layoutConfig: { cta?: FormCta } | null;
}

/** Adapts the authoring `ExpandedVersion` shape into the `EffectiveForm` shape `<FormPreview>`
 * (and every production consumer) expects — every field here is platform-authored, so `scope`/
 * `isSystem`/`needsReview` are trivially fixed rather than resolved from tenant data. */
function toPreviewForm(version: ExpandedVersion | null): EffectiveForm | null {
  if (!version) return null;
  const toField = (f: ExpandedField): RendererField => ({
    id: f.id,
    fieldKey: f.fieldKey,
    label: f.label,
    description: f.description,
    placeholder: f.placeholder,
    fieldType: f.fieldType as RendererField["fieldType"],
    options: f.options,
    defaultValue: null,
    validation: null,
    isRequired: f.isRequired,
    displayOrder: f.displayOrder,
    layout: { colSpan: f.layout?.colSpan ?? 12 },
    scope: f.isSystem ? "system" : "platform",
    isSystem: f.isSystem,
    needsReview: false,
  });
  const toSection = (s: ExpandedSection) => ({ key: s.key, title: s.title, description: s.description, fields: s.fields.map(toField) });
  // A section with no step (`version.sections`) would otherwise vanish from the preview entirely
  // once any step exists — nothing else here ever renders `version.sections` in that case. Folding
  // it into step 1 keeps every field visible instead of silently dropping it, matching the same
  // fold applied in the production merge engine (apps/api's `getEffectiveForm`).
  const steps =
    version.steps.length > 0
      ? version.steps.map((step, index) => ({
          key: step.key,
          title: step.title,
          description: step.description,
          isOptional: step.isOptional,
          sections: [...(index === 0 ? version.sections.map(toSection) : []), ...step.sections.map(toSection)],
        }))
      : [{ key: "default", title: "", description: null, isOptional: false, sections: version.sections.map(toSection) }];
  return { formKey: "", formVersionId: version.id, steps, cta: version.layoutConfig?.cta ?? null };
}

/** Flattens `version.sections` (no step) and every step's own sections into one list, in the
 * order steps/sections are configured — the field drawer's "Section" dropdown and the builder
 * canvas both iterate this. */
function flattenSections(version: ExpandedVersion | null): ExpandedSection[] {
  if (!version) return [];
  return [...version.sections, ...version.steps.flatMap((s) => s.sections)];
}

interface FieldFormState {
  label: string;
  fieldKey: string;
  fieldKeyTouched: boolean;
  fieldType: string;
  description: string;
  placeholder: string;
  options: string[];
  isRequired: boolean;
  colSpan: number;
  sectionKey: string;
}
const EMPTY_FIELD_FORM: FieldFormState = {
  label: "",
  fieldKey: "",
  fieldKeyTouched: false,
  fieldType: "text",
  description: "",
  placeholder: "",
  options: [],
  isRequired: false,
  colSpan: 12,
  sectionKey: "",
};

const DEFAULT_SECTION_KEY = "general";

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Builds the `PATCH .../versions/:versionId` payload's `steps`/`sections` arrays from a
 * version's current structure — every mutation on this page (add field, add step, add section,
 * reorder) starts from this same snapshot and layers one change on top, since the endpoint is a
 * full-replace, not an incremental patch (contracts/form-builder-api.md). */
function currentStructurePayload(version: ExpandedVersion) {
  return {
    steps: version.steps.map((s) => ({ key: s.key, title: s.title, description: s.description, displayOrder: s.displayOrder, isOptional: s.isOptional })),
    sections: flattenSections(version).map((s) => ({ key: s.key, stepKey: s.stepKey, title: s.title, description: s.description, displayOrder: s.displayOrder })),
  };
}

function currentFieldsPayload(version: ExpandedVersion) {
  // System fields are never part of this payload — the server ignores them regardless (they're
  // carried forward automatically), but omitting them here too keeps this page's own model of
  // "what I'm submitting" honest, not just relying on server-side filtering to save it.
  return flattenSections(version)
    .flatMap((s) => s.fields.filter((f) => !f.isSystem).map((f) => ({ ...f, sectionKey: s.key })))
    .map((f) => ({
      sectionKey: f.sectionKey,
      fieldKey: f.fieldKey,
      label: f.label,
      description: f.description,
      placeholder: f.placeholder,
      fieldType: f.fieldType,
      options: f.options,
      isRequired: f.isRequired,
      displayOrder: f.displayOrder,
      layout: f.layout,
    }));
}

/** Same shape as `currentFieldsPayload`, but includes system fields too (with their own
 * `fieldKey`/`sectionKey`, since the drag-reorder mutation is the one caller that legitimately
 * needs to move a field across/around a system field's position — the server accepts a
 * system-keyed entry's `displayOrder` for exactly this, silently ignoring everything else about
 * it, per `replaceDraftStructure`). Every other mutation on this page still uses
 * `currentFieldsPayload` (system fields omitted), which is what keeps them at their existing
 * position unless a reorder explicitly moves them. */
function allFieldsPayloadIncludingSystem(version: ExpandedVersion) {
  return flattenSections(version)
    .flatMap((s) => s.fields.map((f) => ({ ...f, sectionKey: s.key })))
    .map((f) => ({
      sectionKey: f.sectionKey,
      fieldKey: f.fieldKey,
      label: f.label,
      description: f.description,
      placeholder: f.placeholder,
      fieldType: f.fieldType,
      options: f.options,
      isRequired: f.isRequired,
      displayOrder: f.displayOrder,
      layout: f.layout,
    }));
}

export function FormBuilderClient({ formId }: { formId: string }) {
  const queryClient = useQueryClient();

  const [fieldDrawerOpen, setFieldDrawerOpen] = useState(false);
  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState<FieldFormState>(EMPTY_FIELD_FORM);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // A system field only ever opens in this restricted mode — label/type/section/required all
  // stay under `replaceDraftStructure`'s exclusive control; only description/placeholder are
  // editable here, via their own dedicated endpoint (spec: "even if they can't change labels").
  const [editingSystemField, setEditingSystemField] = useState<ExpandedField | null>(null);
  const [systemFieldForm, setSystemFieldForm] = useState({ description: "", placeholder: "" });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  /** Which version's structure is shown in the builder canvas + preview. `null` defers to the
   * draft (if one exists) or the most recent historical version — see `resolvedVersionId` below.
   * Explicitly reset to `null` whenever a mutation changes which version *should* be in view (a
   * fresh draft, a freshly-created one from history) rather than tracked forward by id. */
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [stepForm, setStepForm] = useState({ title: "", description: "" });
  const [editingStepKey, setEditingStepKey] = useState<string | null>(null);
  const [confirmDeleteStepKey, setConfirmDeleteStepKey] = useState<string | null>(null);

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [sectionForm, setSectionForm] = useState({ title: "", stepKey: "" });
  const [editingSectionKey, setEditingSectionKey] = useState<string | null>(null);
  const [confirmDeleteSectionKey, setConfirmDeleteSectionKey] = useState<string | null>(null);

  const [confirmDeleteField, setConfirmDeleteField] = useState<ExpandedField | null>(null);

  // Draggable divider between the builder canvas and the live preview pane — width lives in
  // component state (not persisted) and is dragged via the resizer bar between the two panes.
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

  const detailQuery = useQuery({
    queryKey: ["platform-form-detail", formId],
    queryFn: async (): Promise<FormTypeRow & { versions: VersionSummary[] }> => {
      const res = await fetch(`${API_BASE}/platform/forms/${formId}`, { credentials: "include" });
      const json = (await res.json()) as { data: FormTypeRow & { versions: VersionSummary[] } };
      return json.data;
    },
    enabled: !!formId,
  });
  const detail = detailQuery.data;
  const draftVersion = detail?.versions.find((v) => v.status === "draft") ?? null;
  const historicalVersions = (detail?.versions ?? []).filter((v) => v.status !== "draft").sort((a, b) => b.versionNumber - a.versionNumber);
  const resolvedVersionId = selectedVersionId ?? draftVersion?.id ?? historicalVersions[0]?.id ?? null;
  const isViewingDraft = !!draftVersion && resolvedVersionId === draftVersion.id;

  const versionQuery = useQuery({
    queryKey: ["platform-form-version", resolvedVersionId],
    queryFn: async (): Promise<ExpandedVersion> => {
      const res = await fetch(`${API_BASE}/platform/forms/${formId}/versions/${resolvedVersionId}`, { credentials: "include" });
      const json = (await res.json()) as { data: ExpandedVersion };
      return json.data;
    },
    enabled: !!resolvedVersionId,
  });
  const version = versionQuery.data ?? null;
  const flatSections = flattenSections(version);
  const sectionsWithNoStep = version?.sections ?? [];

  const createDraftMutation = useMutation({
    mutationFn: async (cloneFrom?: string) => {
      const res = await fetch(`${API_BASE}/platform/forms/${formId}/versions`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cloneFrom ? { cloneFrom } : detail?.activeVersionId ? { cloneFrom: "active" } : {}),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't create a new draft.");
      }
    },
    onSuccess: () => {
      setSelectedVersionId(null);
      queryClient.invalidateQueries({ queryKey: ["platform-form-detail", formId] });
    },
    onError: (err: Error) => setPublishError(err.message),
  });

  function openCreateField(sectionKey?: string) {
    setEditingSystemField(null);
    setEditingFieldKey(null);
    setFieldForm({ ...EMPTY_FIELD_FORM, sectionKey: sectionKey ?? flatSections[0]?.key ?? "" });
    setFieldError(null);
    setFieldDrawerOpen(true);
  }

  function openEditField(field: ExpandedField) {
    // System fields open in a separate, restricted mode — label/type/section/required stay
    // locked (the server's dedicated system-field endpoint only ever accepts description/
    // placeholder regardless of what else this drawer might send), everything else works as normal.
    if (field.isSystem) {
      setEditingSystemField(field);
      setSystemFieldForm({ description: field.description ?? "", placeholder: field.placeholder ?? "" });
      setFieldError(null);
      setFieldDrawerOpen(true);
      return;
    }
    setEditingSystemField(null);
    setEditingFieldKey(field.fieldKey);
    setFieldForm({
      label: field.label,
      fieldKey: field.fieldKey,
      fieldKeyTouched: true,
      fieldType: field.fieldType,
      description: field.description ?? "",
      placeholder: field.placeholder ?? "",
      options: field.options ?? [],
      isRequired: field.isRequired,
      colSpan: field.layout?.colSpan ?? 12,
      sectionKey: field.sectionKey,
    });
    setFieldError(null);
    setFieldDrawerOpen(true);
  }

  /** Every structural mutation (field/step/section add, reorder) PATCHes the *entire* draft
   * structure (contracts/form-builder-api.md — the endpoint is a full replace, not incremental),
   * so every mutation function below starts from `currentStructurePayload`/`currentFieldsPayload`
   * and layers exactly one change on top. */
  async function patchDraftStructure(body: { steps: unknown[]; sections: unknown[]; fields: unknown[]; layoutConfig?: { cta?: FormCta } | null }) {
    const res = await fetch(`${API_BASE}/platform/forms/${formId}/versions/${version!.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(json?.message ?? "Couldn't save this change.");
    }
  }

  const saveFieldMutation = useMutation({
    mutationFn: async () => {
      if (!version) return;
      const existingFields = flatSections.flatMap((s) => s.fields).filter((f) => !f.isSystem && f.fieldKey !== editingFieldKey);
      const fieldKey = fieldForm.fieldKey.trim() || slugify(fieldForm.label);

      // A brand-new draft (or a form type with no sections configured yet) has zero sections —
      // rather than requiring "add a section" as a mandatory first step, transparently create a
      // default one so "add field" always works, matching how Department/Member/TNA's single
      // implicit section behaved before this screen supported multiple.
      const targetSectionKey = fieldForm.sectionKey || DEFAULT_SECTION_KEY;
      const sectionsPayload = currentStructurePayload(version).sections;
      const targetSectionExists = sectionsPayload.some((s) => s.key === targetSectionKey);
      if (!targetSectionExists) {
        sectionsPayload.push({ key: targetSectionKey, stepKey: null, title: "General", description: null, displayOrder: sectionsPayload.length });
      }

      const nextDisplayOrder = flatSections.find((s) => s.key === targetSectionKey)?.fields.filter((f) => f.fieldKey !== editingFieldKey).length ?? 0;

      const fieldsPayload = [
        ...existingFields.map((f) => ({
          sectionKey: f.sectionKey,
          fieldKey: f.fieldKey,
          label: f.label,
          description: f.description,
          placeholder: f.placeholder,
          fieldType: f.fieldType,
          options: f.options,
          isRequired: f.isRequired,
          displayOrder: f.displayOrder,
          layout: f.layout,
        })),
        {
          sectionKey: targetSectionKey,
          fieldKey,
          label: fieldForm.label.trim(),
          description: fieldForm.description || null,
          placeholder: fieldForm.placeholder || null,
          fieldType: fieldForm.fieldType,
          options: fieldForm.options.length > 0 ? fieldForm.options : null,
          isRequired: fieldForm.isRequired,
          displayOrder: nextDisplayOrder,
          layout: { colSpan: fieldForm.colSpan },
        },
      ];

      await patchDraftStructure({ steps: currentStructurePayload(version).steps, sections: sectionsPayload, fields: fieldsPayload });
    },
    onSuccess: () => {
      setFieldDrawerOpen(false);
      queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] });
    },
    onError: (err: Error) => setFieldError(err.message),
  });

  const saveSystemFieldMutation = useMutation({
    mutationFn: async () => {
      if (!editingSystemField || !version) return;
      const res = await fetch(`${API_BASE}/platform/forms/${formId}/versions/${version.id}/system-fields/${editingSystemField.fieldKey}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: systemFieldForm.description || null, placeholder: systemFieldForm.placeholder || null }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't save this change.");
      }
    },
    onSuccess: () => {
      setFieldDrawerOpen(false);
      setEditingSystemField(null);
      queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] });
    },
    onError: (err: Error) => setFieldError(err.message),
  });

  function openCreateStep() {
    setEditingStepKey(null);
    setStepForm({ title: "", description: "" });
    setStructureError(null);
    setStepModalOpen(true);
  }
  function openEditStep(step: ExpandedStep) {
    setEditingStepKey(step.key);
    setStepForm({ title: step.title, description: step.description ?? "" });
    setStructureError(null);
    setStepModalOpen(true);
  }

  const stepMutation = useMutation({
    mutationFn: async () => {
      if (!version) return;
      const structure = currentStructurePayload(version);
      if (editingStepKey) {
        const index = structure.steps.findIndex((s) => s.key === editingStepKey);
        if (index !== -1) structure.steps[index] = { ...structure.steps[index], title: stepForm.title.trim(), description: stepForm.description || null };
      } else {
        const key = slugify(stepForm.title) || `step_${structure.steps.length + 1}`;
        // The very first step a form gets makes the form's existing (previously step-less)
        // content into "Step 1" — otherwise the new step would render above content that has no
        // step label of its own at all, reading as if it belonged to the new step without
        // actually being part of it (Form Builder follow-up: "the existing form should become
        // step one"). Only fires once, for whichever step happens to be first; every step added
        // after that behaves exactly as before (starts with zero sections of its own).
        const isFirstStep = structure.steps.length === 0;
        structure.steps.push({ key, title: stepForm.title.trim(), description: stepForm.description || null, displayOrder: structure.steps.length, isOptional: false });
        if (isFirstStep) {
          structure.sections = structure.sections.map((s) => (s.stepKey === null ? { ...s, stepKey: key } : s));
        }
      }
      await patchDraftStructure({ ...structure, fields: currentFieldsPayload(version) });
    },
    onSuccess: () => {
      setStepModalOpen(false);
      setEditingStepKey(null);
      setStepForm({ title: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] });
    },
    onError: (err: Error) => setStructureError(err.message),
  });

  // Deleting a step removes its sections (and those sections' fields) too — a step is a
  // self-contained page of the wizard, not just a label, so nothing sensible would remain of it
  // otherwise. `input.sections` referencing a removed step's key would silently fall back to "no
  // step" rather than error (`replaceDraftStructure`'s insert logic), so this filters them out
  // explicitly instead of relying on that fallback.
  const deleteStepMutation = useMutation({
    mutationFn: async (stepKey: string) => {
      if (!version) return;
      const structure = currentStructurePayload(version);
      const removedSectionKeys = new Set(structure.sections.filter((s) => s.stepKey === stepKey).map((s) => s.key));
      const steps = structure.steps.filter((s) => s.key !== stepKey);
      const sections = structure.sections.filter((s) => s.stepKey !== stepKey);
      const fields = currentFieldsPayload(version).filter((f) => !removedSectionKeys.has(f.sectionKey));
      await patchDraftStructure({ steps, sections, fields });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] }),
    onError: (err: Error) => setStructureError(err.message),
  });

  function openCreateSection(stepKey?: string) {
    setEditingSectionKey(null);
    setSectionForm({ title: "", stepKey: stepKey ?? "" });
    setStructureError(null);
    setSectionModalOpen(true);
  }
  function openEditSection(section: ExpandedSection) {
    setEditingSectionKey(section.key);
    setSectionForm({ title: section.title, stepKey: section.stepKey ?? "" });
    setStructureError(null);
    setSectionModalOpen(true);
  }

  const sectionMutation = useMutation({
    mutationFn: async () => {
      if (!version) return;
      const structure = currentStructurePayload(version);
      if (editingSectionKey) {
        const index = structure.sections.findIndex((s) => s.key === editingSectionKey);
        if (index !== -1) structure.sections[index] = { ...structure.sections[index], title: sectionForm.title.trim(), stepKey: sectionForm.stepKey || null };
      } else {
        const key = slugify(sectionForm.title) || `section_${structure.sections.length + 1}`;
        structure.sections.push({ key, stepKey: sectionForm.stepKey || null, title: sectionForm.title.trim(), description: null, displayOrder: structure.sections.length });
      }
      await patchDraftStructure({ ...structure, fields: currentFieldsPayload(version) });
    },
    onSuccess: () => {
      setSectionModalOpen(false);
      setEditingSectionKey(null);
      setSectionForm({ title: "", stepKey: "" });
      queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] });
    },
    onError: (err: Error) => setStructureError(err.message),
  });

  const deleteSectionMutation = useMutation({
    mutationFn: async (sectionKey: string) => {
      if (!version) return;
      const structure = currentStructurePayload(version);
      const sections = structure.sections.filter((s) => s.key !== sectionKey);
      const fields = currentFieldsPayload(version).filter((f) => f.sectionKey !== sectionKey);
      await patchDraftStructure({ steps: structure.steps, sections, fields });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] }),
    onError: (err: Error) => setStructureError(err.message),
  });

  // Removing a field the Super Admin added — never available for a system field (the drawer
  // never even opens a system field in this mode; enforcement of "can't delete" ultimately still
  // lives server-side in `replaceDraftStructure`, which only ever re-inserts system rows from its
  // own snapshot regardless of what's sent).
  const deleteFieldMutation = useMutation({
    mutationFn: async (field: ExpandedField) => {
      if (!version) return;
      const fields = currentFieldsPayload(version).filter((f) => f.fieldKey !== field.fieldKey);
      await patchDraftStructure({ ...currentStructurePayload(version), fields });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] }),
    onError: (err: Error) => setStructureError(err.message),
  });

  // Drag-and-drop field reordering — the one mutation on this page that deliberately includes
  // system fields in its `fields` payload (`allFieldsPayloadIncludingSystem`), since a field can
  // be dropped anywhere relative to a system field's position; everything else about a system
  // field (label/type/placement-into-a-*different*-section) stays exactly as the server already
  // enforces (`replaceDraftStructure` only ever honors a system-keyed entry's `displayOrder`).
  const reorderFieldsMutation = useMutation({
    mutationFn: async (fields: ReturnType<typeof allFieldsPayloadIncludingSystem>) => {
      if (!version) return;
      await patchDraftStructure({ ...currentStructurePayload(version), fields });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] }),
    onError: (err: Error) => setStructureError(err.message),
  });

  function handleReorderField(targetSectionKey: string, draggedId: string, targetIndex: number) {
    if (!version) return;
    const targetSection = flatSections.find((s) => s.key === targetSectionKey);
    const sourceSection = flatSections.find((s) => s.fields.some((f) => f.id === draggedId));
    if (!targetSection || !sourceSection) return;
    const dragged = sourceSection.fields.find((f) => f.id === draggedId)!;

    if (sourceSection.key === targetSection.key) {
      const withoutDragged = sourceSection.fields.filter((f) => f.id !== draggedId);
      const reordered = [...withoutDragged.slice(0, targetIndex), dragged, ...withoutDragged.slice(targetIndex)];
      const newIndexByFieldKey = new Map(reordered.map((f, index) => [f.fieldKey, index]));
      const fields = allFieldsPayloadIncludingSystem(version).map((f) =>
        f.sectionKey === targetSectionKey && newIndexByFieldKey.has(f.fieldKey) ? { ...f, displayOrder: newIndexByFieldKey.get(f.fieldKey)! } : f,
      );
      reorderFieldsMutation.mutate(fields);
      return;
    }

    // Cross-section (and so cross-step, since a step is just a group of sections) move — never
    // for a system field, whose section placement stays under `replaceDraftStructure`'s exclusive
    // control regardless of what's sent (only its in-section position is ever honored); dropping
    // one onto a different section is a silent no-op rather than a visual move that would just
    // snap back once the server's response comes back (Form Builder follow-up: "we should be able
    // to drag fields between steps").
    if (dragged.isSystem) return;

    const sourceRemaining = sourceSection.fields.filter((f) => f.id !== draggedId);
    const sourceIndexByFieldKey = new Map(sourceRemaining.map((f, index) => [f.fieldKey, index]));
    const targetReordered = [...targetSection.fields.slice(0, targetIndex), dragged, ...targetSection.fields.slice(targetIndex)];
    const targetIndexByFieldKey = new Map(targetReordered.map((f, index) => [f.fieldKey, index]));

    const fields = allFieldsPayloadIncludingSystem(version).map((f) => {
      if (f.fieldKey === dragged.fieldKey) {
        return { ...f, sectionKey: targetSection.key, displayOrder: targetIndexByFieldKey.get(f.fieldKey)! };
      }
      if (f.sectionKey === sourceSection.key && sourceIndexByFieldKey.has(f.fieldKey)) {
        return { ...f, displayOrder: sourceIndexByFieldKey.get(f.fieldKey)! };
      }
      if (f.sectionKey === targetSection.key && targetIndexByFieldKey.has(f.fieldKey)) {
        return { ...f, displayOrder: targetIndexByFieldKey.get(f.fieldKey)! };
      }
      return f;
    });
    reorderFieldsMutation.mutate(fields);
  }

  const reorderStepsMutation = useMutation({
    mutationFn: async (reorderedKeys: string[]) => {
      if (!version) return;
      const structure = currentStructurePayload(version);
      const stepByKey = new Map(structure.steps.map((s) => [s.key, s]));
      const reordered = reorderedKeys.map((key, index) => ({ ...stepByKey.get(key)!, displayOrder: index }));
      await patchDraftStructure({ ...structure, steps: reordered, fields: currentFieldsPayload(version) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] }),
    onError: (err: Error) => setStructureError(err.message),
  });

  function moveStep(stepKey: string, direction: -1 | 1) {
    if (!version) return;
    const keys = version.steps.map((s) => s.key);
    const index = keys.indexOf(stepKey);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= keys.length) return;
    [keys[index], keys[targetIndex]] = [keys[targetIndex], keys[index]];
    reorderStepsMutation.mutate(keys);
  }

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/platform/forms/${formId}/versions/${draftVersion!.id}/publish`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't publish this form.");
      }
    },
    onSuccess: () => {
      setPublishError(null);
      queryClient.invalidateQueries({ queryKey: ["platform-form-detail", formId] });
    },
    onError: (err: Error) => setPublishError(err.message),
  });

  // Submit-button text/position (form_versions.layout_config.cta) — local editing state, reset
  // from the loaded version whenever the selected version changes so switching versions (or
  // creating a fresh draft) never leaks a stale, unsaved edit onto a different version's fields.
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaAlign, setCtaAlign] = useState<NonNullable<FormCta["align"]>>("right");
  // Collapsed by default — the editor only appears once "Edit CTA Button" is clicked, and closes
  // again on a successful save (or the explicit close control), rather than sitting open in the
  // canvas at all times.
  const [ctaEditorOpen, setCtaEditorOpen] = useState(false);
  useEffect(() => {
    setCtaLabel(version?.layoutConfig?.cta?.label ?? "");
    setCtaAlign(version?.layoutConfig?.cta?.align ?? "right");
    setCtaEditorOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id]);

  const ctaMutation = useMutation({
    mutationFn: async () => {
      if (!version) return;
      await patchDraftStructure({
        ...currentStructurePayload(version),
        fields: currentFieldsPayload(version),
        layoutConfig: { cta: { label: ctaLabel.trim() || undefined, align: ctaAlign } },
      });
    },
    onSuccess: () => {
      setCtaEditorOpen(false);
      queryClient.invalidateQueries({ queryKey: ["platform-form-version", version?.id] });
    },
    onError: (err: Error) => setStructureError(err.message),
  });

  const showOptions = fieldForm.fieldType === "select" || fieldForm.fieldType === "multiselect" || fieldForm.fieldType === "radio";
  const previewForm = toPreviewForm(version);

  function toCanvasField(field: ExpandedField, editable: boolean): CanvasField {
    return {
      id: field.id,
      label: field.label,
      isRequired: field.isRequired,
      typeLabel: FIELD_TYPE_LABELS[field.fieldType as FieldType] ?? field.fieldType,
      badges: field.isSystem ? [{ text: "System", variant: "neutral" }] : [],
      actions: editable && !field.isSystem ? [{ label: "Delete", icon: Trash2, destructive: true, onClick: () => setConfirmDeleteField(field) }] : [],
      onClick: editable ? () => openEditField(field) : undefined,
      draggable: editable,
    };
  }

  function toCanvasSection(section: ExpandedSection, editable: boolean): CanvasSection {
    return {
      key: section.key,
      title: section.title || "Untitled section",
      emptyTitle: !section.title,
      fields: section.fields.map((f) => toCanvasField(f, editable)),
      actions: editable
        ? [
            { label: "Edit", icon: Pencil, onClick: () => openEditSection(section) },
            { label: "Delete", icon: Trash2, destructive: true, onClick: () => setConfirmDeleteSectionKey(section.key) },
          ]
        : undefined,
      onAddField: editable ? () => openCreateField(section.key) : undefined,
    };
  }

  function toCanvasStep(step: ExpandedStep, index: number, totalSteps: number, editable: boolean): CanvasStep {
    const actions: CanvasAction[] = [];
    if (editable) {
      if (index > 0) actions.push({ label: "Move up", icon: ArrowUp, onClick: () => moveStep(step.key, -1) });
      if (index < totalSteps - 1) actions.push({ label: "Move down", icon: ArrowDown, onClick: () => moveStep(step.key, 1) });
      actions.push({ label: "Edit", icon: Pencil, onClick: () => openEditStep(step) });
      actions.push({ label: "Delete", icon: Trash2, destructive: true, onClick: () => setConfirmDeleteStepKey(step.key) });
    }
    return {
      key: step.key,
      title: step.title,
      sections: step.sections.map((s) => toCanvasSection(s, editable)),
      actions: editable ? actions : undefined,
      onAddSection: editable ? () => openCreateSection(step.key) : undefined,
    };
  }

  const canvasSteps = version ? version.steps.map((step, index) => toCanvasStep(step, index, version.steps.length, isViewingDraft)) : [];
  const canvasNoStepSections = sectionsWithNoStep.map((s) => toCanvasSection(s, isViewingDraft));

  if (detailQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading…</div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-slate-500">This form couldn&apos;t be found.</p>
        <Link href="/platform/forms" className="text-sm font-medium text-cta hover:underline">
          ← Back to Form List
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/platform/forms" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-primary">
            <ArrowLeft className="h-4 w-4" />
            Back to Form List
          </Link>
          <div className="h-5 w-px bg-border" />
          <p className="text-sm font-semibold text-primary">{detail.name}</p>
          {draftVersion ? (
            <Badge variant="neutral">Draft v{draftVersion.versionNumber}</Badge>
          ) : detail.activeVersionId ? (
            <Badge variant="success">Published</Badge>
          ) : (
            <Badge variant="neutral">No published version</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!draftVersion && (
            <Button variant="secondary" onClick={() => createDraftMutation.mutate(undefined)} isLoading={createDraftMutation.isPending}>
              New draft
            </Button>
          )}
          {draftVersion && (
            <Button onClick={() => publishMutation.mutate()} isLoading={publishMutation.isPending}>
              Publish
            </Button>
          )}
        </div>
      </header>

      {publishError && <div className="banner-error mx-6 mt-3 shrink-0">{publishError}</div>}

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `220px minmax(0,1fr) 6px ${previewWidth}px` }}>
        {/* VERSIONS */}
        <aside className="overflow-y-auto border-r border-border bg-white px-3 py-5">
          <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Versions</p>
          <nav className="space-y-0.5">
            {draftVersion && (
              <button
                type="button"
                onClick={() => setSelectedVersionId(draftVersion.id)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                  resolvedVersionId === draftVersion.id ? "bg-slate-100 font-medium text-primary" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>Draft v{draftVersion.versionNumber}</span>
                <Badge variant="neutral">Draft</Badge>
              </button>
            )}
            {historicalVersions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVersionId(v.id)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                  resolvedVersionId === v.id ? "bg-slate-100 font-medium text-primary" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>Version {v.versionNumber}</span>
                <Badge variant={v.status === "published" ? "success" : "neutral"}>{v.status === "published" ? "Active" : "Archived"}</Badge>
              </button>
            ))}
            {!draftVersion && historicalVersions.length === 0 && <p className="px-2 text-sm text-slate-400">No versions yet.</p>}
          </nav>
        </aside>

        {/* FORM BUILDER */}
        <main className="overflow-y-auto px-6 py-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Form Builder</p>
            {version && !isViewingDraft && <p className="text-xs text-slate-400">Read-only — this version is {version.status}.</p>}
          </div>
          {structureError && <div className="banner-error mb-4">{structureError}</div>}

          {version ? (
            <div className="space-y-6">
              <FormBuilderCanvas steps={canvasSteps} noStepSections={canvasNoStepSections} onReorderField={isViewingDraft ? handleReorderField : undefined} />

              {flatSections.length === 0 && <p className="text-sm italic text-slate-400">No sections yet — add a field to create the default section, or add one explicitly.</p>}

              {isViewingDraft && (
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
              )}

              {isViewingDraft && (
                <CtaEditor
                  label={ctaLabel}
                  align={ctaAlign}
                  onLabelChange={setCtaLabel}
                  onAlignChange={setCtaAlign}
                  onSave={() => ctaMutation.mutate()}
                  isSaving={ctaMutation.isPending}
                  error={structureError}
                  isOpen={ctaEditorOpen}
                  onOpen={() => setCtaEditorOpen(true)}
                  onClose={() => setCtaEditorOpen(false)}
                />
              )}

              {!isViewingDraft && !draftVersion && (
                <Button variant="secondary" onClick={() => createDraftMutation.mutate(version.id)} isLoading={createDraftMutation.isPending}>
                  New draft from this version
                </Button>
              )}
            </div>
          ) : (
            <Card className="p-8 text-center text-sm text-slate-500">Create a draft to start building this form.</Card>
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
              {previewForm ? <FormPreview key={version?.id ?? "empty"} form={previewForm} /> : <p className="text-sm text-slate-400">Nothing to preview yet.</p>}
            </Card>
          </div>
        </aside>
      </div>

      <Modal
        open={stepModalOpen}
        onClose={() => {
          setStepModalOpen(false);
          setEditingStepKey(null);
        }}
        title={editingStepKey ? "Edit step" : "Add step"}
      >
        <div className="space-y-4">
          {structureError && <div className="banner-error">{structureError}</div>}
          <Input label="Title" required value={stepForm.title} onChange={(e) => setStepForm((f) => ({ ...f, title: e.target.value }))} />
          <Input label="Description" value={stepForm.description} onChange={(e) => setStepForm((f) => ({ ...f, description: e.target.value }))} />
          <Button className="w-full" isLoading={stepMutation.isPending} disabled={!stepForm.title.trim()} onClick={() => stepMutation.mutate()}>
            {editingStepKey ? "Save changes" : "Add step"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={sectionModalOpen}
        onClose={() => {
          setSectionModalOpen(false);
          setEditingSectionKey(null);
        }}
        title={editingSectionKey ? "Edit section" : "Add section"}
      >
        <div className="space-y-4">
          {structureError && <div className="banner-error">{structureError}</div>}
          <Input
            label="Title"
            placeholder="Untitled section"
            value={sectionForm.title}
            onChange={(e) => setSectionForm((f) => ({ ...f, title: e.target.value }))}
          />
          {version && version.steps.length > 0 && (
            <div>
              <label className="field-label" htmlFor="sectionStepKey">
                Step (optional)
              </label>
              <select id="sectionStepKey" className="field-input" value={sectionForm.stepKey} onChange={(e) => setSectionForm((f) => ({ ...f, stepKey: e.target.value }))}>
                <option value="">No step</option>
                {version.steps.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button className="w-full" isLoading={sectionMutation.isPending} onClick={() => sectionMutation.mutate()}>
            {editingSectionKey ? "Save changes" : "Add section"}
          </Button>
        </div>
      </Modal>

      <Drawer
        open={fieldDrawerOpen}
        onClose={() => {
          setFieldDrawerOpen(false);
          setEditingSystemField(null);
        }}
        side="right"
        title={editingSystemField ? "Edit system field" : editingFieldKey ? "Edit field" : "Add field"}
      >
        {editingSystemField ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveSystemFieldMutation.mutate();
            }}
          >
            {fieldError && <div className="banner-error">{fieldError}</div>}
            <div>
              <p className="field-label">Label</p>
              <p className="text-sm text-secondary">{editingSystemField.label}</p>
              <p className="mt-1 text-xs text-slate-400">
                This is a system field — its label, type, and placement are fixed and can&apos;t be changed here.
              </p>
            </div>
            <Input
              label="Description / help text"
              value={systemFieldForm.description}
              onChange={(e) => setSystemFieldForm((f) => ({ ...f, description: e.target.value }))}
            />
            <Input
              label="Placeholder"
              value={systemFieldForm.placeholder}
              onChange={(e) => setSystemFieldForm((f) => ({ ...f, placeholder: e.target.value }))}
            />
            <Button type="submit" isLoading={saveSystemFieldMutation.isPending} className="w-full">
              Save changes
            </Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!fieldForm.label.trim()) {
                setFieldError("Label is required.");
                return;
              }
              saveFieldMutation.mutate();
            }}
          >
            {fieldError && <div className="banner-error">{fieldError}</div>}
          <Input
            label="Label"
            required
            value={fieldForm.label}
            onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value, fieldKey: f.fieldKeyTouched ? f.fieldKey : slugify(e.target.value) }))}
          />
          {!editingFieldKey && (
            <Input label="Field key" value={fieldForm.fieldKey} onChange={(e) => setFieldForm((f) => ({ ...f, fieldKey: e.target.value, fieldKeyTouched: true }))} />
          )}
          <div>
            <label className="field-label" htmlFor="fieldType">
              Field type
            </label>
            <select
              id="fieldType"
              className="field-input"
              value={fieldForm.fieldType}
              onChange={(e) => setFieldForm((f) => ({ ...f, fieldType: e.target.value }))}
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="sectionKey">
              Section
            </label>
            <select id="sectionKey" className="field-input" value={fieldForm.sectionKey} onChange={(e) => setFieldForm((f) => ({ ...f, sectionKey: e.target.value }))}>
              <option value="">{flatSections.length === 0 ? "General (created automatically)" : "— Select a section —"}</option>
              {flatSections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <Input label="Description / help text" value={fieldForm.description} onChange={(e) => setFieldForm((f) => ({ ...f, description: e.target.value }))} />
          <Input label="Placeholder" value={fieldForm.placeholder} onChange={(e) => setFieldForm((f) => ({ ...f, placeholder: e.target.value }))} />
          {showOptions && (
            <div>
              <p className="field-label">Options</p>
              <div className="space-y-2">
                {fieldForm.options.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      className="field-input"
                      value={option}
                      onChange={(e) => setFieldForm((f) => ({ ...f, options: f.options.map((o, i) => (i === index ? e.target.value : o)) }))}
                    />
                    <button type="button" className="cursor-pointer text-sm text-red-600" onClick={() => setFieldForm((f) => ({ ...f, options: f.options.filter((_, i) => i !== index) }))}>
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" className="text-sm font-medium text-cta hover:underline cursor-pointer" onClick={() => setFieldForm((f) => ({ ...f, options: [...f.options, ""] }))}>
                  + Add option
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="colSpan">
              Column width (of 12)
            </label>
            <input
              id="colSpan"
              type="number"
              min={1}
              max={12}
              className="field-input"
              value={fieldForm.colSpan}
              onChange={(e) => setFieldForm((f) => ({ ...f, colSpan: Number(e.target.value) || 12 }))}
            />
          </div>
            <Toggle label="Required" checked={fieldForm.isRequired} onChange={(checked) => setFieldForm((f) => ({ ...f, isRequired: checked }))} />
            <Button type="submit" isLoading={saveFieldMutation.isPending} className="w-full">
              {editingFieldKey ? "Save changes" : "Add field"}
            </Button>
          </form>
        )}
      </Drawer>

      <Modal open={confirmDeleteSectionKey !== null} onClose={() => setConfirmDeleteSectionKey(null)} title="Delete this section?">
        <p className="mb-4">Its fields will be deleted too. This cannot be undone.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            isLoading={deleteSectionMutation.isPending}
            onClick={() => {
              if (confirmDeleteSectionKey) deleteSectionMutation.mutate(confirmDeleteSectionKey);
              setConfirmDeleteSectionKey(null);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onClick={() => setConfirmDeleteSectionKey(null)}>
            Cancel
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDeleteStepKey !== null} onClose={() => setConfirmDeleteStepKey(null)} title="Delete this step?">
        <p className="mb-4">Its sections and fields will be deleted too. This cannot be undone.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            isLoading={deleteStepMutation.isPending}
            onClick={() => {
              if (confirmDeleteStepKey) deleteStepMutation.mutate(confirmDeleteStepKey);
              setConfirmDeleteStepKey(null);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onClick={() => setConfirmDeleteStepKey(null)}>
            Cancel
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDeleteField !== null} onClose={() => setConfirmDeleteField(null)} title="Delete this field?">
        <p className="mb-4">This cannot be undone.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            isLoading={deleteFieldMutation.isPending}
            onClick={() => {
              if (confirmDeleteField) deleteFieldMutation.mutate(confirmDeleteField);
              setConfirmDeleteField(null);
            }}
          >
            Delete
          </Button>
          <Button variant="outline" onClick={() => setConfirmDeleteField(null)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
