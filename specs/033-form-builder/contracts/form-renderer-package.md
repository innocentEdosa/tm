# Contract: `@tm/form-builder` Public Package API

The package's only public surface (`packages/form-builder/src/index.ts`) — anything not exported
here is a private implementation detail consuming pages must not import directly (FR-027/FR-028).

## `useEffectiveForm(formKey: string)`

```ts
function useEffectiveForm(formKey: string): {
  form: EffectiveForm | null;
  isLoading: boolean;
  error: Error | null;
};
```
Thin `@tanstack/react-query` wrapper around `GET /tenant/forms/:formKey/effective`
(`contracts/form-builder-api.md`). `form: null` while loading or if the form type has never been
published — callers decide their own empty-state (spec Edge Cases).

## `<FormRenderer>`

```tsx
<FormRenderer
  form={effectiveForm}                 // EffectiveForm — required
  values={values}                      // Record<fieldKey, unknown> — required
  onChange={(fieldKey, value) => void} // required
  onSubmit={(values) => void | Promise<void>}  // required
  errors={serverErrors}                // Record<fieldKey, string> — optional, server-side errors
  isSubmitting={boolean}               // optional, disables submit + shows a loading state
  readOnly={boolean}                   // optional — renders values without inputs (used by
                                        //   "view" drawers and by builder/preview disabled mode)
  fieldRenderers={{                    // optional — escape hatch, FR-029
    [fieldKey: string]: React.ComponentType<FieldRendererProps>
  }}
/>
```

**Contract guarantees** (FR-027):
- Renders every field type in `form.steps[].sections[].fields[]` using a built-in component
  unless `fieldRenderers[field.fieldKey]` is supplied, in which case that component renders
  instead (receiving `{ field, value, onChange, error, readOnly }`) — the one integration point
  Department's Manager/Assistant-Manager person-picker uses (research.md, spec's Assumptions).
- Handles multi-column layout via each field's `layout.colSpan` on a 12-column grid, sections,
  and — when `form.steps.length > 1` — step navigation with per-step required-field validation
  before advancing (FR-019), all without the caller implementing any of it.
- Required-field and type/validation errors are computed client-side from the same rules the
  server enforces (mirrors `validateFieldValue`) and merged with any `errors` prop (server-side
  rejection response) so both sources render identically.
- A field whose `scope` is `"system"` and has no matching `fieldRenderers` entry renders a plain
  generic input for its nominal `fieldType` — matching spec 010's existing "system field labels
  are nominal placeholders" behavior for any system field a consuming page hasn't supplied a
  custom renderer for.

## `<FormPreview>`

```tsx
<FormPreview form={effectiveFormOrDraftPreview} />
```
A thin wrapper around `<FormRenderer readOnly values={{}} onChange={noop} onSubmit={noop} />` —
guarantees (FR-028) that the Form Builder's own preview panel (both Super Admin authoring a
platform version and Tenant Admin previewing their tenant's effective form) renders through the
*exact same* component tree as production consumption. `form` here may be either a published
`EffectiveForm` or the shape returned by `GET /platform/forms/:id/versions/:versionId` for an
in-progress draft — both satisfy the same `FormShape` type the renderer consumes.

## `<FormBuilder>`

```tsx
<FormBuilder
  formDefinitionId={id}
  version={draftVersion}               // from GET /platform/forms/:id/versions/:versionId
  mode="platform" | "tenant"           // gates which affordances are shown/allowed
  onChange={(patch) => void}           // emits PATCH /platform/forms/.../versions/:id-shaped
                                        //   or tenant-field-shaped patches depending on `mode`
/>
```
`mode="platform"`: full authoring (add/edit/remove/reorder fields, steps, sections; edit platform
field definitions) — used only behind `requireSuperAdminSession`-gated screens.
`mode="tenant"`: restricted per FR-021–FR-023 — can add tenant fields, hide/reorder within
allowed bounds, cannot edit or remove a platform field's own definition (only its visibility for
that tenant) — used behind the Settings > Forms screen. Both modes render their live preview via
the shared `<FormPreview>` above, never a second renderer (FR-028).

## Types (`packages/form-builder/src/types/`)

`EffectiveForm`, `FormField`, `FormStep`, `FormSection` mirror the shapes in
`data-model.md`/`contracts/form-builder-api.md` exactly — these are the single source of truth
for the wire shape; the package does not redefine an incompatible internal shape.
