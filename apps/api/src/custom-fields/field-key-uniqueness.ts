import { and, eq, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { formDefinitions, formFields, formFieldOrderOverrides } from "../db/schema/custom-fields";
import { formSteps, formSections } from "../db/schema/form-builder";
import type { FieldRow } from "./field-validation";

export interface MergedFieldRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  options: unknown;
  isRequired: boolean;
  displayOrder: number;
  scope: "system" | "global" | "tenant";
  isSystem: boolean;
  /** Form Builder spec (033) FR-021 — this tenant has hidden this field from their own
   * production rendering (never possible for `isSystem`/`isRequired` rows, enforced at write
   * time in `apps/api/src/form-builder/visibility-rules.ts`). `getFormFields` deliberately keeps
   * hidden rows in its result (unlike `getEffectiveForm`, which excludes them) — this function
   * backs the tenant-facing *management* list (Settings > Forms), which needs to show a hidden
   * field so it can be unhidden; `getEffectiveForm` backs actual form *rendering*, which must
   * never show it. */
  isHidden: boolean;
  /** The *effective* description/placeholder — a tenant's own help-text override (Form Builder
   * spec follow-up: system/platform fields' wording is editable per-tenant even though their
   * label/type/binding stay fixed) takes precedence over the field's own stored value. */
  description: string | null;
  placeholder: string | null;
  /** The active version's section/step this field renders under — `null` only when the form has
   * never been published (no active version to place anything in yet). A tenant field whose own
   * placement has gone stale (its section was removed by a republish) falls back the same way
   * `getEffectiveForm` does, flagged via `needsReview` rather than silently misplaced. */
  sectionKey: string | null;
  sectionTitle: string | null;
  stepKey: string | null;
  stepTitle: string | null;
  needsReview: boolean;
}

/** The whole form's field layout — system (module-hardcoded) fields, global (Super Admin) fields,
 * and this tenant's own fields, as one flat, tenant-reorderable sequence (superseding this
 * framework's original "tenant fields only reorder among themselves" rule, per direct product
 * feedback). Effective order is each field's own seeded/default `displayOrder`, overridden by a
 * matching `form_field_order_overrides` row when the caller's own tenant has dragged it elsewhere
 * (RLS-scoped via `tenantDb` — that table only ever shows the caller's own overrides). A field's
 * `label`/`fieldType`/`isRequired`/`options` are never affected by an override, only its position —
 * and for `isSystem` rows those are nominal placeholders anyway (the consuming module always renders
 * its own real, hardcoded control, matched by `fieldKey`). */
export async function getFormFields(tenantDb: Db, formKey: string): Promise<MergedFieldRow[]> {
  const [definition] = await tenantDb
    .select({ id: formDefinitions.id, activeVersionId: formDefinitions.activeVersionId })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, formKey));
  if (!definition) {
    return [];
  }

  // A platform/system field row exists once per *version* it's ever belonged to (drafts get
  // cloned, publishing archives the version, but the old rows themselves are never deleted) —
  // without this, every past version's copy of e.g. "Assistant Manager" would show up here
  // alongside the current one. A tenant's own field is never version-scoped (`formVersionId`
  // is always null on those rows), so it's always included regardless.
  const activeVersionCondition = definition.activeVersionId ? eq(formFields.formVersionId, definition.activeVersionId) : sql`false`;
  const rows = await tenantDb
    .select()
    .from(formFields)
    .where(
      and(
        eq(formFields.formDefinitionId, definition.id),
        isNull(formFields.archivedAt),
        or(isNotNull(formFields.tenantId), activeVersionCondition),
      ),
    );

  // Same shape as the fields condition above — the active version's own platform steps/sections,
  // plus this tenant's own (never version-scoped, RLS already narrows `isNotNull(tenantId)` rows
  // to just this caller's own — Form Builder spec follow-up: "the tenant can have sections and
  // steps too, it just only affects their tenant").
  const activeStepCondition = definition.activeVersionId ? eq(formSteps.formVersionId, definition.activeVersionId) : sql`false`;
  const steps = await tenantDb.select().from(formSteps).where(and(eq(formSteps.formDefinitionId, definition.id), or(isNotNull(formSteps.tenantId), activeStepCondition)));
  const activeSectionCondition = definition.activeVersionId ? eq(formSections.formVersionId, definition.activeVersionId) : sql`false`;
  const sections = await tenantDb
    .select()
    .from(formSections)
    .where(and(eq(formSections.formDefinitionId, definition.id), or(isNotNull(formSections.tenantId), activeSectionCondition)));
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const fallbackSection = sections.find((s) => s.formStepId === null) ?? sections[0] ?? null;

  const overrides = await tenantDb
    .select({
      fieldId: formFieldOrderOverrides.fieldId,
      displayOrder: formFieldOrderOverrides.displayOrder,
      isHidden: formFieldOrderOverrides.isHidden,
      description: formFieldOrderOverrides.description,
      placeholder: formFieldOrderOverrides.placeholder,
    })
    .from(formFieldOrderOverrides)
    .where(eq(formFieldOrderOverrides.formDefinitionId, definition.id));
  const overrideByFieldId = new Map(overrides.map((o) => [o.fieldId, o]));

  const scopeOf = (row: FieldRow): "system" | "global" | "tenant" => {
    if (row.isSystem) return "system";
    return row.tenantId === null ? "global" : "tenant";
  };

  const merged: MergedFieldRow[] = rows.map((row) => {
    let sectionId = row.formSectionId;
    let needsReview = false;
    if (!sectionId || !sectionById.has(sectionId)) {
      sectionId = fallbackSection?.id ?? null;
      // Only a tenant-owned placement can genuinely go stale this way — a platform/system
      // field's `formSectionId` always points into its own (now-active) version's own sections.
      needsReview = row.tenantId !== null;
    }
    const section = sectionId ? (sectionById.get(sectionId) ?? null) : null;
    const step = section?.formStepId ? (stepById.get(section.formStepId) ?? null) : null;

    return {
      id: row.id,
      fieldKey: row.fieldKey,
      label: row.label,
      fieldType: row.fieldType,
      options: row.options,
      isRequired: row.isRequired,
      displayOrder: overrideByFieldId.get(row.id)?.displayOrder ?? row.displayOrder,
      scope: scopeOf(row),
      isSystem: row.isSystem,
      isHidden: overrideByFieldId.get(row.id)?.isHidden ?? false,
      description: overrideByFieldId.get(row.id)?.description ?? row.description,
      placeholder: overrideByFieldId.get(row.id)?.placeholder ?? row.placeholder,
      sectionKey: section?.key ?? null,
      sectionTitle: section?.title ?? null,
      stepKey: step?.key ?? null,
      stepTitle: step?.title ?? null,
      needsReview,
    };
  });

  merged.sort((a, b) => a.displayOrder - b.displayOrder);
  return merged;
}

/** research.md §2 — the literal `(tenantId, formDefinitionId, fieldKey)` unique index does not by
 * itself catch a cross-scope collision (a tenant field vs. an existing global field), since Postgres
 * treats a NULL `tenantId` as a different value, not something that conflicts with a real tenant
 * UUID. Checks across *both* scopes (a tenant session's RLS-scoped view of `form_fields` is already
 * exactly "global rows ∪ this tenant's own rows" — data-model.md — so no explicit tenant filter is
 * needed here), including archived rows (an archived field's key isn't immediately reusable). */
export async function fieldKeyCollisionExists(
  tenantDb: Db,
  formDefinitionId: string,
  fieldKey: string,
  excludeFieldId?: string,
): Promise<boolean> {
  const conditions = [
    eq(formFields.formDefinitionId, formDefinitionId),
    eq(formFields.fieldKey, fieldKey),
  ];
  if (excludeFieldId) {
    conditions.push(ne(formFields.id, excludeFieldId));
  }
  const [existing] = await tenantDb
    .select({ id: formFields.id })
    .from(formFields)
    .where(and(...conditions));
  return !!existing;
}
