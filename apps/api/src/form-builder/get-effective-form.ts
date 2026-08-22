import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields, formFieldOrderOverrides } from "../db/schema/custom-fields";
import { formVersions, formSteps, formSections, tenantFormCtaOverrides } from "../db/schema/form-builder";
import type { FormLayoutConfig } from "./version-helpers";

export interface EffectiveFormField {
  id: string;
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
  layout: { colSpan: number };
  scope: "system" | "platform" | "tenant";
  isSystem: boolean;
  /** True only for a tenant field/override whose original step/section no longer exists in the
   * currently active version (spec FR-025) — its data is preserved, never dropped, but it has
   * fallen back to the default section and the tenant should review its placement. */
  needsReview: boolean;
}

export interface EffectiveFormSection {
  key: string;
  title: string;
  description: string | null;
  icon: string | null;
  fields: EffectiveFormField[];
}

export interface EffectiveFormStep {
  key: string;
  title: string;
  description: string | null;
  isOptional: boolean;
  sections: EffectiveFormSection[];
}

export interface EffectiveForm {
  formKey: string;
  formVersionId: string;
  steps: EffectiveFormStep[];
  /** The active version's submit-button text/position, configured through the Form Builder
   * (`form_versions.layout_config`) — `<FormRenderer>` falls back to a plain "Submit" when this
   * (or a specific setting within it) isn't set. */
  cta: FormLayoutConfig["cta"] | null;
  /** Form-level response policy (multiple-responses feature, `form_definitions.allow_multiple_
   * responses`) — surfaced here so a consuming feature's frontend can read it from the same call
   * it already makes for rendering, without a second round-trip. `false` (the default) means a
   * respondent may have at most one response; enforcement of that limit still lives in the
   * consuming feature's own write route, never here (see get-effective-form.ts module doc). */
  allowMultipleResponses: boolean;
}

/**
 * Resolves the fully-merged form a specific tenant should see for `formKey` (data-model.md
 * "Effective Form", spec FR-026): the currently published platform version's steps/sections/
 * fields, plus the caller's own tenant fields and visibility/position overrides, minus anything
 * that tenant has hidden. Returns `null` when the form type doesn't exist or has never been
 * published (spec Edge Cases — a clearly empty result, not an error).
 *
 * Merge-at-read-time, not a clone (research.md §1) — platform field definitions are read live
 * from the currently active version on every call, never copied into tenant-owned storage.
 */
export async function getEffectiveForm(
  tenantDb: Db,
  formKey: string,
  tenantId: string,
): Promise<EffectiveForm | null> {
  const [definition] = await tenantDb
    .select({
      id: formDefinitions.id,
      activeVersionId: formDefinitions.activeVersionId,
      allowMultipleResponses: formDefinitions.allowMultipleResponses,
    })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, formKey));
  if (!definition || !definition.activeVersionId) {
    return null;
  }

  const [version] = await tenantDb
    .select({ id: formVersions.id, layoutConfig: formVersions.layoutConfig })
    .from(formVersions)
    .where(eq(formVersions.id, definition.activeVersionId));
  if (!version) {
    return null;
  }

  // A tenant's own steps/sections (Form Builder spec follow-up: "the tenant can have sections and
  // steps too, it just only affects their tenant") are never version-scoped — they're appended
  // after the platform version's own, same as a tenant's own fields already are, so their own
  // structure survives every republish untouched (no reconciliation needed — it was never tied to
  // any platform version to begin with).
  const tenantSteps = await tenantDb
    .select()
    .from(formSteps)
    .where(and(eq(formSteps.formDefinitionId, definition.id), eq(formSteps.tenantId, tenantId)));
  const steps = [
    ...(await tenantDb.select().from(formSteps).where(eq(formSteps.formVersionId, version.id))),
    ...tenantSteps,
  ].sort((a, b) => a.displayOrder - b.displayOrder);

  const tenantSections = await tenantDb
    .select()
    .from(formSections)
    .where(and(eq(formSections.formDefinitionId, definition.id), eq(formSections.tenantId, tenantId)));
  const sections = [
    ...(await tenantDb.select().from(formSections).where(eq(formSections.formVersionId, version.id))),
    ...tenantSections,
  ].sort((a, b) => a.displayOrder - b.displayOrder);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  // The section a field falls back to when its own placement is missing or orphaned — the
  // first section with no parent step, or simply the first section, whichever exists.
  const fallbackSection = sections.find((s) => s.formStepId === null) ?? sections[0] ?? null;

  // Platform fields live on this version; tenant fields are never version-scoped (spec
  // Assumptions — a tenant's customizations apply immediately, no publish step of their own).
  const platformFields = await tenantDb
    .select()
    .from(formFields)
    .where(and(eq(formFields.formVersionId, version.id), isNull(formFields.archivedAt)));

  const tenantFields = await tenantDb
    .select()
    .from(formFields)
    .where(
      and(
        eq(formFields.formDefinitionId, definition.id),
        eq(formFields.tenantId, tenantId),
        isNull(formFields.archivedAt),
      ),
    );

  const allFields = [...platformFields, ...tenantFields];

  const overrides = await tenantDb
    .select()
    .from(formFieldOrderOverrides)
    .where(
      and(
        eq(formFieldOrderOverrides.tenantId, tenantId),
        eq(formFieldOrderOverrides.formDefinitionId, definition.id),
      ),
    );
  const overrideByFieldId = new Map(overrides.map((o) => [o.fieldId, o]));

  const scopeOf = (row: (typeof allFields)[number]): "system" | "platform" | "tenant" => {
    if (row.isSystem) return "system";
    return row.tenantId === null ? "platform" : "tenant";
  };

  const fieldsBySectionId = new Map<string, EffectiveFormField[]>();
  for (const row of allFields) {
    const override = overrideByFieldId.get(row.id);
    // A tenant has hidden this optional platform field from their own rendering (spec FR-021) —
    // enforcement that a *required*/*system* field could never have reached this state at all
    // lives in visibility-rules.ts, at write time, not here.
    if (override?.isHidden) continue;

    let sectionId = row.formSectionId;
    let needsReview = false;
    if (!sectionId || !sectionById.has(sectionId)) {
      sectionId = fallbackSection?.id ?? null;
      // Only a tenant-owned placement can genuinely go stale this way — a platform field's
      // `formSectionId` always points into its own version's own sections.
      needsReview = row.tenantId !== null;
    }
    if (!sectionId) continue;

    const layout = (row.layout as { colSpan?: number } | null) ?? null;
    const field: EffectiveFormField = {
      id: row.id,
      fieldKey: row.fieldKey,
      label: row.label,
      // A tenant's own help-text override (system/platform fields only get a Tenant Admin's
      // wording changed here, never the shared row itself — see form_field_order_overrides).
      description: override?.description ?? row.description,
      placeholder: override?.placeholder ?? row.placeholder,
      fieldType: row.fieldType,
      options: row.options,
      defaultValue: row.defaultValue,
      validation: row.validation,
      isRequired: row.isRequired,
      displayOrder: override?.displayOrder ?? row.displayOrder,
      layout: { colSpan: layout?.colSpan ?? 12 },
      scope: scopeOf(row),
      isSystem: row.isSystem,
      needsReview,
    };
    const list = fieldsBySectionId.get(sectionId) ?? [];
    list.push(field);
    fieldsBySectionId.set(sectionId, list);
  }
  for (const list of fieldsBySectionId.values()) {
    list.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  const buildSection = (section: (typeof sections)[number]): EffectiveFormSection => ({
    key: section.key,
    title: section.title,
    description: section.description,
    icon: section.icon,
    fields: fieldsBySectionId.get(section.id) ?? [],
  });

  const sectionsByStepId = new Map<string | null, typeof sections>();
  for (const section of sections) {
    const key = section.formStepId;
    const list = sectionsByStepId.get(key) ?? [];
    list.push(section);
    sectionsByStepId.set(key, list);
  }

  // A form with zero configured steps renders as one implicit step (spec Edge Cases) — a
  // rendering convention, not a stored row, so this case never needs special-casing upstream.
  const effectiveSteps: EffectiveFormStep[] =
    steps.length === 0
      ? [
          {
            key: "default",
            title: "",
            description: null,
            isOptional: false,
            sections: (sectionsByStepId.get(null) ?? []).map(buildSection),
          },
        ]
      : steps.map((step, index) => ({
          key: step.key,
          title: step.title,
          description: step.description,
          isOptional: step.isOptional,
          // A section with no `formStepId` (added before this version had any steps, or never
          // explicitly assigned one) would otherwise vanish entirely once a step exists — nothing
          // upstream renders `sectionsByStepId.get(null)` once `steps.length > 0`. Folding it into
          // step 1 keeps every field visible rather than silently dropping it from the form.
          sections: [...(index === 0 ? (sectionsByStepId.get(null) ?? []).map(buildSection) : []), ...(sectionsByStepId.get(step.id) ?? []).map(buildSection)],
        }));

  const layoutConfig = (version.layoutConfig as FormLayoutConfig | null) ?? null;

  // A tenant's own CTA wording (Form Builder spec follow-up) takes precedence over the platform
  // version's own `layout_config.cta`, never touching that shared row.
  const [ctaOverride] = await tenantDb
    .select({ cta: tenantFormCtaOverrides.cta })
    .from(tenantFormCtaOverrides)
    .where(and(eq(tenantFormCtaOverrides.tenantId, tenantId), eq(tenantFormCtaOverrides.formDefinitionId, definition.id)));
  const cta = (ctaOverride?.cta as FormLayoutConfig["cta"] | undefined) ?? layoutConfig?.cta ?? null;

  return { formKey, formVersionId: version.id, steps: effectiveSteps, cta, allowMultipleResponses: definition.allowMultipleResponses };
}
