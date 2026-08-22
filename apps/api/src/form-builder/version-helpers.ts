import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { formFields } from "../db/schema/custom-fields";
import { formVersions, formSteps, formSections } from "../db/schema/form-builder";
import { slugify } from "../custom-fields/field-validation";

export interface ExpandedField {
  id: string;
  sectionKey: string;
  fieldKey: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  fieldType: string;
  options: unknown;
  defaultValue: unknown;
  validation: unknown;
  isRequired: boolean;
  displayOrder: number;
  layout: unknown;
  /** True for a placeholder row owned by the consuming module's own hardcoded field (e.g.
   * Department's Name) — the Form Builder (even a Super Admin session) can never create, edit,
   * or remove one of these; only a migration can. Surfaced here so the builder UI can lock them,
   * but the *actual* enforcement lives in `replaceDraftStructure` below, not in this flag alone. */
  isSystem: boolean;
}

export interface ExpandedSection {
  id: string;
  stepKey: string | null;
  key: string;
  title: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
  fields: ExpandedField[];
}

export interface ExpandedStep {
  id: string;
  key: string;
  title: string;
  description: string | null;
  displayOrder: number;
  isOptional: boolean;
  sections: ExpandedSection[];
}

/** `form_versions.layout_config` — a small, deliberately-open bag for presentation settings that
 * apply to the whole version rather than one field (spec: editable submit-button text/position).
 * Left as a loose object (not a dedicated column per setting) so a future addition here never
 * needs its own migration. */
export interface FormLayoutConfig {
  cta?: {
    label?: string;
    align?: "left" | "center" | "right" | "full";
  };
}

export interface ExpandedVersion {
  id: string;
  versionNumber: number;
  status: string;
  publishedAt: Date | null;
  steps: ExpandedStep[];
  /** Sections with no parent step, when the version has none configured. */
  sections: ExpandedSection[];
  layoutConfig: FormLayoutConfig | null;
}

/** The authoring shape for `GET /platform/forms/:id/versions/:versionId` and the response of a
 * `PATCH` — full nested steps→sections→fields, unlike the tenant-facing merged `EffectiveForm`
 * (which additionally merges in tenant fields/overrides). */
export async function expandVersion(db: Db, versionId: string): Promise<ExpandedVersion | null> {
  const [version] = await db.select().from(formVersions).where(eq(formVersions.id, versionId));
  if (!version) return null;

  const steps = (
    await db.select().from(formSteps).where(eq(formSteps.formVersionId, versionId))
  ).sort((a, b) => a.displayOrder - b.displayOrder);
  const sections = (
    await db.select().from(formSections).where(eq(formSections.formVersionId, versionId))
  ).sort((a, b) => a.displayOrder - b.displayOrder);
  const fields = (
    await db.select().from(formFields).where(eq(formFields.formVersionId, versionId))
  ).sort((a, b) => a.displayOrder - b.displayOrder);

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const fieldsBySectionId = new Map<string, ExpandedField[]>();
  for (const f of fields) {
    if (!f.formSectionId) continue;
    const list = fieldsBySectionId.get(f.formSectionId) ?? [];
    list.push({
      id: f.id,
      sectionKey: sectionById.get(f.formSectionId)?.key ?? "",
      fieldKey: f.fieldKey,
      label: f.label,
      description: f.description,
      placeholder: f.placeholder,
      fieldType: f.fieldType,
      options: f.options,
      defaultValue: f.defaultValue,
      validation: f.validation,
      isRequired: f.isRequired,
      displayOrder: f.displayOrder,
      layout: f.layout,
      isSystem: f.isSystem,
    });
    fieldsBySectionId.set(f.formSectionId, list);
  }

  const buildSection = (s: (typeof sections)[number]): ExpandedSection => ({
    id: s.id,
    stepKey: s.formStepId ? (stepById.get(s.formStepId)?.key ?? null) : null,
    key: s.key,
    title: s.title,
    description: s.description,
    icon: s.icon,
    displayOrder: s.displayOrder,
    fields: fieldsBySectionId.get(s.id) ?? [],
  });

  const sectionsByStepId = new Map<string | null, typeof sections>();
  for (const s of sections) {
    const list = sectionsByStepId.get(s.formStepId) ?? [];
    list.push(s);
    sectionsByStepId.set(s.formStepId, list);
  }

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    publishedAt: version.publishedAt,
    steps: steps.map((step) => ({
      id: step.id,
      key: step.key,
      title: step.title,
      description: step.description,
      displayOrder: step.displayOrder,
      isOptional: step.isOptional,
      sections: (sectionsByStepId.get(step.id) ?? []).map(buildSection),
    })),
    sections: (sectionsByStepId.get(null) ?? []).map(buildSection),
    layoutConfig: (version.layoutConfig as FormLayoutConfig | null) ?? null,
  };
}

export interface StepInput {
  key: string;
  title: string;
  description?: string | null;
  displayOrder: number;
  isOptional?: boolean;
}
export interface SectionInput {
  stepKey?: string | null;
  key: string;
  title: string;
  description?: string | null;
  icon?: string | null;
  displayOrder: number;
}
export interface FieldInput {
  sectionKey: string;
  fieldKey?: string;
  label: string;
  description?: string | null;
  placeholder?: string | null;
  fieldType: string;
  options?: string[] | null;
  defaultValue?: unknown;
  validation?: Record<string, unknown> | null;
  isRequired?: boolean;
  displayOrder: number;
  layout?: { colSpan?: number } | null;
}

export class DraftValidationError extends Error {}

/**
 * Full delete-and-reinsert of a draft version's steps/sections/*non-system* fields (spec's
 * `PATCH /platform/forms/:id/versions/:versionId`, contracts/form-builder-api.md). Safe only
 * because nothing outside this framework ever references a *draft* version's field ids — no
 * tenant customization or submission can point at a field that has never been published
 * (data-model.md, `getEffectiveForm` only ever reads a version once it's the active/published
 * one).
 *
 * System field rows are the one thing this function never lets `input.fields` touch — it snapshots
 * this version's own current system rows *before* anything is deleted, then re-inserts them
 * unchanged, regardless of what the client sent. This is the actual enforcement point (a bug
 * previously let a client silently downgrade a system field to an ordinary platform field just
 * by including it in a PATCH — found by clicking through the running app): client-submitted
 * `isSystem`/field data is never trusted to decide which rows are system rows, only this
 * version's own prior database state (or, for cloning, the source version — see
 * `cloneVersionInto`) is.
 */
export async function replaceDraftStructure(
  db: Db,
  versionId: string,
  input: { steps?: StepInput[]; sections?: SectionInput[]; fields?: FieldInput[]; layoutConfig?: FormLayoutConfig | null },
): Promise<void> {
  if (input.layoutConfig !== undefined) {
    await db.update(formVersions).set({ layoutConfig: input.layoutConfig, updatedAt: new Date() }).where(eq(formVersions.id, versionId));
  }

  // Steps/sections now carry their own `formDefinitionId` directly (0116 — a tenant-owned row has
  // no `formVersionId` to derive it through), so this is needed unconditionally, not just when
  // fields exist.
  const formDefinitionId = (await db.select({ formDefinitionId: formVersions.formDefinitionId }).from(formVersions).where(eq(formVersions.id, versionId)))[0]
    .formDefinitionId;

  const existingSystemFields = await db
    .select({
      fieldKey: formFields.fieldKey,
      label: formFields.label,
      description: formFields.description,
      placeholder: formFields.placeholder,
      fieldType: formFields.fieldType,
      options: formFields.options,
      defaultValue: formFields.defaultValue,
      validation: formFields.validation,
      isRequired: formFields.isRequired,
      displayOrder: formFields.displayOrder,
      layout: formFields.layout,
      sectionKey: formSections.key,
    })
    .from(formFields)
    .innerJoin(formSections, eq(formSections.id, formFields.formSectionId))
    .where(and(eq(formFields.formVersionId, versionId), eq(formFields.isSystem, true)));
  const systemFieldKeys = new Set(existingSystemFields.map((f) => f.fieldKey));

  await db.delete(formFields).where(eq(formFields.formVersionId, versionId));
  await db.delete(formSections).where(eq(formSections.formVersionId, versionId));
  await db.delete(formSteps).where(eq(formSteps.formVersionId, versionId));

  const stepIdByKey = new Map<string, string>();
  for (const step of input.steps ?? []) {
    const [created] = await db
      .insert(formSteps)
      .values({
        formDefinitionId,
        formVersionId: versionId,
        key: step.key,
        title: step.title,
        description: step.description ?? null,
        displayOrder: step.displayOrder,
        isOptional: step.isOptional ?? false,
      })
      .returning();
    stepIdByKey.set(step.key, created.id);
  }

  const sectionIdByKey = new Map<string, string>();
  for (const section of input.sections ?? []) {
    const formStepId = section.stepKey ? (stepIdByKey.get(section.stepKey) ?? null) : null;
    const [created] = await db
      .insert(formSections)
      .values({
        formDefinitionId,
        formVersionId: versionId,
        formStepId,
        key: section.key,
        title: section.title,
        description: section.description ?? null,
        icon: section.icon ?? null,
        displayOrder: section.displayOrder,
      })
      .returning();
    sectionIdByKey.set(section.key, created.id);
  }
  const fallbackSectionId = sectionIdByKey.size > 0 ? [...sectionIdByKey.values()][0] : null;

  // A system-keyed entry in `input.fields` never changes label/type/placement (those stay
  // locked to `existingSystemFields`'s own snapshot below) — but its `displayOrder` IS honored,
  // the one thing drag-reorder needs to move a field across/around a system field's fixed slot
  // without the two numbering schemes colliding (Form Builder follow-up: "drag and drop to
  // reorder the inputs"). A caller that simply echoes the current structure back (the common
  // case — add/edit field never repositions anything) sends the same value already stored, a
  // no-op either way.
  const systemFieldDisplayOrderOverride = new Map<string, number>();
  for (const field of input.fields ?? []) {
    const fieldKey = field.fieldKey?.trim() || slugify(field.label);
    if (systemFieldKeys.has(fieldKey)) {
      systemFieldDisplayOrderOverride.set(fieldKey, field.displayOrder);
    }
  }

  // Re-insert this version's system fields exactly as they were — never from `input.fields`,
  // except for position (see override map above).
  for (const sysField of existingSystemFields) {
    const formSectionId = sectionIdByKey.get(sysField.sectionKey) ?? fallbackSectionId;
    if (!formSectionId) continue;
    await db.insert(formFields).values({
      formDefinitionId,
      tenantId: null,
      formVersionId: versionId,
      formSectionId,
      fieldKey: sysField.fieldKey,
      label: sysField.label,
      description: sysField.description,
      placeholder: sysField.placeholder,
      fieldType: sysField.fieldType,
      options: sysField.options,
      defaultValue: sysField.defaultValue,
      validation: sysField.validation,
      isRequired: sysField.isRequired,
      displayOrder: systemFieldDisplayOrderOverride.get(sysField.fieldKey) ?? sysField.displayOrder,
      layout: sysField.layout,
      createdBy: "system",
      isSystem: true,
    });
  }

  const seenFieldKeys = new Set<string>();
  for (const field of input.fields ?? []) {
    const fieldKey = field.fieldKey?.trim() || slugify(field.label);
    if (systemFieldKeys.has(fieldKey)) {
      // Silently ignored, not an error — a client echoing back the current structure
      // (existingFields.map(...)) will naturally include system rows; this just means "no-op
      // for this one," not "reject the whole request." (Its displayOrder was already consumed
      // above, before this loop.)
      continue;
    }
    const formSectionId = sectionIdByKey.get(field.sectionKey);
    if (!formSectionId) {
      throw new DraftValidationError(`Field "${field.label}" references unknown section "${field.sectionKey}"`);
    }
    if (seenFieldKeys.has(fieldKey)) {
      throw new DraftValidationError(`Duplicate field key "${fieldKey}" in this version`);
    }
    seenFieldKeys.add(fieldKey);

    await db.insert(formFields).values({
      formDefinitionId,
      tenantId: null,
      formVersionId: versionId,
      formSectionId,
      fieldKey,
      label: field.label,
      description: field.description ?? null,
      placeholder: field.placeholder ?? null,
      fieldType: field.fieldType,
      options: field.options ?? null,
      defaultValue: field.defaultValue ?? null,
      validation: field.validation ?? null,
      isRequired: field.isRequired ?? false,
      displayOrder: field.displayOrder,
      layout: field.layout ?? null,
      createdBy: "super_admin",
      isSystem: false,
    });
  }
}

/** spec FR-005 — starting a new draft from an existing version's structure. System fields aren't
 * part of the client-facing `fields` contract `replaceDraftStructure` accepts (it never lets a
 * client create/edit them), so they're copied directly here instead, matched into the
 * newly-created target sections by key. */
export async function cloneVersionInto(db: Db, sourceVersionId: string, targetVersionId: string): Promise<void> {
  const source = await expandVersion(db, sourceVersionId);
  if (!source) return;

  const allSourceSections = [...source.sections, ...source.steps.flatMap((s) => s.sections)];

  const steps: StepInput[] = source.steps.map((s) => ({
    key: s.key,
    title: s.title,
    description: s.description,
    displayOrder: s.displayOrder,
    isOptional: s.isOptional,
  }));
  const sections: SectionInput[] = allSourceSections.map((s) => ({
    stepKey: s.stepKey,
    key: s.key,
    title: s.title,
    description: s.description,
    icon: s.icon,
    displayOrder: s.displayOrder,
  }));
  const nonSystemFields: FieldInput[] = allSourceSections.flatMap((s) =>
    s.fields
      .filter((f) => !f.isSystem)
      .map((f) => ({
        sectionKey: s.key,
        fieldKey: f.fieldKey,
        label: f.label,
        description: f.description,
        placeholder: f.placeholder,
        fieldType: f.fieldType,
        options: f.options as string[] | null,
        defaultValue: f.defaultValue,
        validation: f.validation as Record<string, unknown> | null,
        isRequired: f.isRequired,
        displayOrder: f.displayOrder,
        layout: f.layout as { colSpan?: number } | null,
      })),
  );
  await replaceDraftStructure(db, targetVersionId, { steps, sections, fields: nonSystemFields, layoutConfig: source.layoutConfig });

  const targetSections = await db.select().from(formSections).where(eq(formSections.formVersionId, targetVersionId));
  const targetSectionIdByKey = new Map(targetSections.map((s) => [s.key, s.id]));
  const fallbackTargetSectionId = targetSections[0]?.id ?? null;
  const systemFieldRows = allSourceSections.flatMap((s) => s.fields.filter((f) => f.isSystem));
  if (systemFieldRows.length === 0) return;

  const [{ formDefinitionId }] = await db
    .select({ formDefinitionId: formVersions.formDefinitionId })
    .from(formVersions)
    .where(eq(formVersions.id, targetVersionId));

  for (const s of allSourceSections) {
    for (const field of s.fields) {
      if (!field.isSystem) continue;
      const formSectionId = targetSectionIdByKey.get(s.key) ?? fallbackTargetSectionId;
      if (!formSectionId) continue;
      await db.insert(formFields).values({
        formDefinitionId,
        tenantId: null,
        formVersionId: targetVersionId,
        formSectionId,
        fieldKey: field.fieldKey,
        label: field.label,
        description: field.description,
        placeholder: field.placeholder,
        fieldType: field.fieldType,
        options: field.options,
        defaultValue: field.defaultValue,
        validation: field.validation,
        isRequired: field.isRequired,
        displayOrder: field.displayOrder,
        layout: field.layout,
        createdBy: "system",
        isSystem: true,
      });
    }
  }
}

/**
 * spec FR-025 — carries a tenant field/override forward when the new version still has a
 * section with the same `key` it was previously anchored to; leaves it untouched otherwise
 * (`getEffectiveForm`'s read-time fallback + `needsReview` flag covers the "no longer exists"
 * case — this pass only handles the "still exists, just re-point" case, silently, no flag).
 */
export async function reconcileTenantFieldsOnPublish(
  db: Db,
  formDefinitionId: string,
  previousVersionId: string | null,
  newVersionId: string,
): Promise<void> {
  if (!previousVersionId) return;

  const oldSections = await db.select().from(formSections).where(eq(formSections.formVersionId, previousVersionId));
  const oldSectionById = new Map(oldSections.map((s) => [s.id, s]));
  const newSections = await db.select().from(formSections).where(eq(formSections.formVersionId, newVersionId));
  const newSectionByKey = new Map(newSections.map((s) => [s.key, s]));

  const tenantFields = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formDefinitionId, formDefinitionId), isNotNull(formFields.tenantId)));

  for (const field of tenantFields) {
    const oldSection = field.formSectionId ? oldSectionById.get(field.formSectionId) : undefined;
    const newSection = oldSection ? newSectionByKey.get(oldSection.key) : undefined;
    if (newSection && newSection.id !== field.formSectionId) {
      await db.update(formFields).set({ formSectionId: newSection.id }).where(eq(formFields.id, field.id));
    }
  }
}
