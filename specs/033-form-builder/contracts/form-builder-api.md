# Contract: Form Builder API

Two route groups, mirroring the codebase's existing platform-vs-tenant split. Platform routes
live in a new `apps/api/src/form-builder/platform-form-routes.ts`; tenant routes extend
`apps/api/src/custom-fields/tenant-form-routes.ts` (or a sibling
`apps/api/src/form-builder/tenant-form-builder-routes.ts`). The existing spec-010 routes
(`GET /tenant/form-definitions`, `GET/POST/PATCH /tenant/form-fields`,
`PUT /tenant/form-fields/reorder`, `GET/PUT /tenant/custom-field-values`) are **unchanged** and
keep serving the not-yet-migrated Settings > Forms screen and any consumer not yet on
`getEffectiveForm` — see data-model.md's migration sequencing for why this is safe.

---

## Platform routes (Super Admin)

All routes below: `preHandler: [requireSuperAdminSession]` only — no `permissions` table check
(research.md §7).

### `POST /platform/forms`

**Body**: `{ name: string; key: string; description: string; icon?: string }`.

**Behavior**: `400` if `name`/`key`/`description` missing. `409` if `key` already exists
(FR-002). Inserts a `form_definitions` row with `created_by_super_admin_id` = caller,
`status: 'active'`, no `active_version_id` yet.

**Response** `201`: `{ success: true, data: { id, key, name, description, icon, status } }`.

### `GET /platform/forms`

**Query**: `page?: number, pageSize?: number, search?: string` — server-side paginated (default
page size 25), matching `apps/api/src/tenant-management/list-tenants.ts`'s exact convention.
`search` matches `name` or `key`, case-insensitive substring.

**Response** `200`: `{ success: true, data: { forms: FormDefinition[], meta: { page, pageSize,
total } } }` — every form type regardless of status (archived included, for the Super Admin's own
management list at `/platform/forms`).

### `GET /platform/forms/:id`

**Response** `200`: the form type plus its version list summary
(`{ ...FormDefinition, versions: [{ id, versionNumber, status, publishedAt }] }`).

### `PATCH /platform/forms/:id`

**Body**: `{ name?: string; description?: string; icon?: string; status?: "active" | "archived" }`.
`key` is never accepted (FR-003, immutable).

### `POST /platform/forms/:id/versions`

**Body**: `{ cloneFrom?: "active" | versionId }` — omit to start empty; `"active"` clones the
current `active_version_id`'s steps/sections/fields as the new draft's starting point (FR-005).

**Behavior**: `409` if a draft version already exists for this form type (one draft at a time,
keeps "which draft am I editing" unambiguous for the builder UI). Inserts `form_versions` row
(`status: 'draft'`, next `version_number`), and, if cloning, deep-copies steps/sections/fields
(new ids, same `key`s, `form_version_id` pointed at the new draft).

**Response** `201`: `{ success: true, data: { id, versionNumber, status: "draft" } }`.

### `GET /platform/forms/:id/versions`

**Response** `200`: `{ success: true, data: FormVersion[] }`, newest first.

### `GET /platform/forms/:id/versions/:versionId`

**Response** `200`: the full draft/published/archived version, expanded —
`{ id, versionNumber, status, steps: [{ ...step, sections: [{ ...section, fields: [...] }] }] }`
(sections with no step nested under a synthetic top-level entry when the version has no steps).
This is also literally what the builder's preview panel feeds into `<FormPreview>`.

### `PATCH /platform/forms/:id/versions/:versionId`

**Body**: partial replace of `{ steps, sections, fields, layoutConfig }` — accepts the same
nested shape as the `GET` above. `409` if `versionId`'s `status !== 'draft'` (FR-009 — published/
archived versions are immutable, edit via a new draft instead).

**Behavior**: field-level operations (add/edit/remove/reorder within steps/sections) all funnel
through this one PATCH for the draft — the builder UI debounces/batches edits rather than firing
one request per keystroke; exact batching granularity is an implementation detail, not a contract
concern.

### `POST /platform/forms/:id/versions/:versionId/publish`

**Behavior** (FR-007, FR-008, FR-025):
1. `409` if `versionId`'s `status !== 'draft'`.
2. `422` if validation fails — at least one section with at least one field, per spec's Edge
   Cases (empty-form publish rejected) — returns `{ success: false, errors: [...] }`.
3. Transactionally: set this version `status = 'published', published_at = now()`; if a prior
   published version exists for this form type, set it `status = 'archived', archived_at =
   now()`; update `form_definitions.active_version_id`.
4. Reconciliation pass (FR-025): for every tenant field/override anchored (via `form_section_id`)
   to a section `key` that existed in the *previous* active version, look up the matching `key`
   in the *new* version's sections; if found, re-point `form_section_id` at the new section's
   row; if not found, re-point at the new version's fallback/default section and mark the
   override row `needsReview = true` (surfaced by `GET /tenant/forms/:formKey/effective`, not a
   separate notification channel in this contract).

**Response** `200`: `{ success: true, data: { id, versionNumber, status: "published",
publishedAt } }`.

### `POST /platform/forms/:id/versions/:versionId/archive`

**Behavior**: `409` if `versionId` is the current `active_version_id` (must publish a replacement
first, or explicitly clear `active_version_id` — out of scope for v1, a form type always keeps
its last published version active once one exists). Otherwise sets `status = 'archived'`.

---

## Tenant routes

All routes below: `preHandler: [requireTenantUserSession()]`, plus `forms.manage.tenant` where
noted (research.md §7 — no new permission key).

### `GET /tenant/forms/:formKey/effective`

**Permission**: none beyond `requireTenantUserSession()` — same "the entity's own permission
gates the page" reasoning as spec 010's `GET /tenant/form-fields` (FR-010 carried forward).

**Response** `200`: the `EffectiveForm` shape from data-model.md — `{ success: true, data:
EffectiveForm }`. `{ success: true, data: null }` if the form type doesn't exist or has never
been published (spec Edge Cases — "clearly empty/not-found result", not an error).

This is the one call `useEffectiveForm(formKey)` (in `@tm/form-builder`) makes.

### `POST /tenant/forms/:formKey/fields`

**Permission**: `forms.manage.tenant`.

**Body**: `{ label, fieldKey?, fieldType, description?, placeholder?, options?, defaultValue?,
validation?, isRequired?, layout?: { colSpan }, sectionKey?: string }`. Same collision/derivation
rules as spec 010's `POST /tenant/form-fields` (FR-014), extended with the new optional
presentation fields and `sectionKey` (placement — defaults to the active version's fallback
section if omitted or unresolvable).

**Response** `201`: the created field in `EffectiveForm`'s field shape (`scope: "tenant"`).

### `PATCH /tenant/forms/:formKey/fields/:fieldId`

**Permission**: `forms.manage.tenant`. Same shape/behavior as spec 010's existing `PATCH
/tenant/form-fields/:fieldId` (`404` for any row not owned by the caller's tenant — RLS makes a
platform or cross-tenant row simply unreachable), extended to accept the new presentation fields.

### `PATCH /tenant/forms/:formKey/fields/:fieldId/visibility`

**Permission**: `forms.manage.tenant`.

**Body**: `{ hidden: boolean }`.

**Behavior** (FR-021, FR-022): resolves `:fieldId` against the merged effective-field set (so
this also accepts a *platform* field's id, unlike the plain PATCH above which only ever resolves
tenant-owned rows). `403` if the target field is `isSystem` or `isRequired` and `hidden: true` is
requested. Otherwise upserts a `form_field_order_overrides` row (`is_hidden` set, `display_order`
untouched unless also provided).

**Response** `200`: `{ success: true }`.

### `PUT /tenant/forms/:formKey/fields/reorder`

**Permission**: `forms.manage.tenant`. Same behavior as spec 010's existing `PUT
/tenant/form-fields/reorder` (whole-form flat reorder via `form_field_order_overrides`), scoped
now to operate within the active published version's step/section structure rather than a flat
list — a field's `displayOrder` override only ever reorders it among its own section's siblings,
never moves it across sections (cross-section placement, if ever added, is a distinct future
capability, not part of this contract).
