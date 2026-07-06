# Feature Specification: Extensible Custom Fields Framework

**Feature Branch**: `010-custom-fields-framework`

**Created**: 2026-07-06

**Status**: Draft

**Input**: User description: "Extensible Custom Fields Framework — foundational infrastructure so modules (Department Management, Training Needs Analysis, future modules) can let Super Admins set global default extra fields per form type, and tenant admins extend their own tenant's instance of that form with additional fields, without any module defining its own ad-hoc 'extra fields' mechanism. Form types themselves are developer-registered, never admin-creatable. Rendering merges an entity's fixed system fields with global and tenant-specific custom fields in display order. Introduces a new top-level 'Settings' sidebar section (peer to Administration) containing Authentication (relocated) and Forms (new)."

## Clarifications

### Session 2026-07-06

- Q: Does this spec include retrofitting Department's already-shipped (Spec 009) create/edit form to
  actually render and save custom field values, or is that deferred follow-up work? → A: In scope —
  this spec also updates Department's create/edit form to render and save custom field values, giving
  the framework one real, working, demoable consumer rather than only its own test harness.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tenant Admin extends a form with their own fields (Priority: P1)

A Tenant Admin opens Settings > Forms, selects an existing form type (e.g. "Department"), and adds a
field their own organization needs (e.g. "Cost Center") that no other tenant sees and that Super Admin
never defined.

**Why this priority**: This is the entire value proposition of the framework from a tenant's point of
view — without it, tenants are stuck with whatever fields ship in code, exactly the problem this spec
exists to solve (Principle III).

**Independent Test**: As a user holding `forms.manage.tenant`, open Settings > Forms, select
"Department", add a text field, and confirm it appears — editable, reorderable among other tenant
fields — without needing any Super Admin action first.

**Acceptance Scenarios**:

1. **Given** a user holding `forms.manage.tenant`, **When** they open Settings > Forms and select a
   form type, **Then** they see every global (Super-Admin-set) field for that form marked as a
   read-only "Global" row, and every field their own tenant has already added as an editable row.
2. **Given** the "+ Add field" action, **When** the user submits a label, an editable
   auto-generated field key, a field type, options (if select/multiselect), and whether it's
   required, **Then** the new field is saved scoped to their own tenant only and appears in the list.
3. **Given** two or more tenant-added fields, **When** the user reorders them, **Then** their relative
   order changes, but no tenant field can be moved ahead of or interleaved among the global fields.
4. **Given** a field key that already exists for that form (either a global field or one of this
   tenant's own fields), **When** the user tries to save a new field with that same key, **Then** the
   save is rejected with a clear inline message before anything is written.

---

### User Story 2 - A form renders the correct merged fields for everyone filling it out (Priority: P1)

Any user with the right permission for an entity (e.g. `department.manage`) opens that entity's
create/edit form and sees the entity's fixed fields, followed by every applicable global and
tenant-specific custom field, in the configured order — with no separate permission needed just to see
or fill in the custom fields.

**Why this priority**: The configuration screen from User Story 1 has no purpose if the fields it
creates don't actually show up, in the right order, on the real form — this is the other half of the
same value proposition, and both are needed for a working MVP.

**Independent Test**: With a form type that has one global field and one tenant field configured, open
that entity's create/edit form as a user holding only the entity's own permission (not
`forms.manage.tenant`) and confirm both custom fields render, in `display_order`, after the entity's
system fields, with required/type validation enforced on submit.

**Acceptance Scenarios**:

1. **Given** a form type with a global field and a tenant-specific field configured, **When** any user
   holding the entity's own permission opens that entity's form, **Then** the entity's system fields
   render first, followed by the global field, followed by the tenant field, in `display_order`, with
   no duplicates.
2. **Given** a required custom field, **When** the user submits the form without a value for it,
   **Then** the submission is rejected with a field-level message, consistent with how the entity's
   own required system fields already behave.
3. **Given** a field of a specific type (e.g. `date`, `select`), **When** the user submits a value that
   doesn't match that type or isn't one of the configured options, **Then** the submission is rejected.

---

### User Story 3 - Global fields stay locked to tenant admins (Priority: P2)

A Tenant Admin viewing Settings > Forms can see every global field Super Admin has defined, understands
they're platform-wide defaults, and cannot edit, delete, or reorder them through any interaction path —
including a direct API call, not just what the UI happens to hide.

**Why this priority**: This is the safety boundary that makes "global defaults tenants can extend but
not break" actually true — without it, one tenant could silently corrupt the default experience for
every other tenant. Depends on User Story 1's screen existing, so it's P2.

**Independent Test**: As a `forms.manage.tenant` user, attempt to edit, delete, or reorder a global
field both through the UI (confirm no interactive affordance exists) and via a direct API call to the
same endpoint used for tenant fields (confirm it's rejected), for a field with `tenant_id = null`.

**Acceptance Scenarios**:

1. **Given** a global field displayed in Settings > Forms, **When** a Tenant Admin views it, **Then**
   it shows a visible "Global" indicator and no edit/delete/reorder controls.
2. **Given** a direct API call attempting to edit, delete, or reorder a field with no owning tenant,
   **When** it's made by a `forms.manage.tenant`-holding user (not a Super Admin), **Then** it is
   rejected, regardless of what the UI would have shown.

---

### User Story 4 - Archiving a field never loses historical data (Priority: P2)

A Tenant Admin removes a tenant field that's no longer needed. Existing records that already have a
value stored for it keep that value intact; the field simply stops appearing on future form renders.

**Why this priority**: Protects data integrity once fields and submitted values exist — depends on
User Stories 1 and 2 having produced real data to protect, so it's P2.

**Independent Test**: Add a tenant field, submit a value for it on a real entity, archive the field,
and confirm the field no longer appears on that form going forward while the previously stored value
is still retrievable (e.g. via a historical record or report), not deleted.

**Acceptance Scenarios**:

1. **Given** a tenant field with at least one stored value, **When** a Tenant Admin removes it,
   **Then** the field is archived (hidden from future renders), not hard-deleted, and its historical
   values remain in place, unmodified.
2. **Given** an archived field, **When** any form for that form type is rendered afterward, **Then**
   the archived field does not appear, and no validation is applied to it.

---

### User Story 5 - Settings becomes its own top-level sidebar section (Priority: P3)

Any user with system-configuration access sees a "Settings" section in the sidebar, separate from
"Administration," containing Authentication (moved from its previous location) and the new Forms
screen — and any existing link to the old Authentication location still works.

**Why this priority**: Pure navigation/information-architecture change — valuable for keeping this
system-configuration concern visually distinct from Administration's people/access concern, but it
doesn't block the framework's core value (User Stories 1-4) from working, so it's the lowest priority.

**Independent Test**: Open the sidebar and confirm "Settings" appears as its own top-level entry
(not nested under Administration) containing Authentication and Forms; visit the old Authentication
Settings URL directly and confirm it still resolves correctly.

**Acceptance Scenarios**:

1. **Given** the sidebar, **When** it renders, **Then** "Settings" appears as a top-level section,
   distinct from and not nested under "Administration," containing "Authentication" and "Forms."
2. **Given** a bookmark or link to the previous Authentication Settings location, **When** it's
   visited, **Then** it still resolves to the same content (redirected if its URL changed), rather than
   breaking.

---

### Edge Cases

- What happens when a tenant tries to add a field whose key collides with an existing *global* field's
  key for the same form (not just another tenant field)? Rejected — field-key uniqueness for a form is
  enforced across both the global set and the tenant's own set, not only within the tenant's own rows,
  so no two fields on the same rendered form can ever share a key.
- What happens if Super Admin later adds a global field whose key collides with a field some tenant
  already added themselves? Out of scope for this spec's UI (Super Admin authoring isn't built here),
  but the data layer must reject it for the same reason — this is a data-model correctness requirement
  this spec's schema/constraints must satisfy even before that authoring screen exists.
- What happens to a tenant's already-submitted entity records when a *newly added* required field
  appears later? Not retroactively invalidated — required-field validation applies only when that
  specific entity record is next created or edited, never applied backward to existing records.
- What happens if a user's role loses `forms.manage.tenant` after they've already added fields? The
  fields they added remain exactly as they are (visible, functioning, still rendered on forms) — losing
  the permission only removes the ability to add/edit/delete/reorder going forward.
- What happens when a Tenant Admin tries to reorder a tenant field to a position before/after a global
  field? Rejected — tenant fields can only be reordered relative to each other; global fields' relative
  position is fixed from a tenant's point of view.
- What happens if a form type has zero configured custom fields (neither global nor tenant)? The form
  renders with only its system fields, exactly as it did before this framework existed — no empty
  section, no broken layout.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support form types being registered only through a code/deployment change —
  no API endpoint, Super Admin console, or tenant-facing UI can create a new form type.
- **FR-002**: System MUST allow a Super Admin to define, for any registered form type, a set of global
  default fields (name, field type, options where applicable, required flag, display order) that apply
  to every tenant unless a tenant has added its own field. *(Data-model support only in this spec — the
  Super Admin authoring UI itself is out of scope here; see Assumptions.)*
- **FR-003**: System MUST allow a user holding `forms.manage.tenant` to add, edit, reorder, and remove
  fields scoped only to their own tenant, for any registered form type.
- **FR-004**: System MUST prevent a user holding only `forms.manage.tenant` (not a Super Admin) from
  editing, deleting, or reordering a global field, under any interaction path including a direct API
  call.
- **FR-005**: System MUST enforce field-key uniqueness per form type across both the global field set
  and a given tenant's own field set — a tenant cannot add a field whose key matches an existing global
  field's key or one of its own existing fields' keys.
- **FR-006**: System MUST render, for any entity belonging to a registered form type, the entity's own
  fixed system fields first, followed by every applicable global field and the current tenant's own
  fields, merged and ordered by display order, with no duplicates.
- **FR-007**: System MUST validate a submitted custom field value against its configured type and its
  required flag, on every create/edit submission, independent of the entity's own system-field
  validation.
- **FR-008**: System MUST support at minimum these field types: single-line text, multi-line text,
  number, date, single-select (from configured options), and multi-select (from configured options).
- **FR-009**: System MUST archive (hide from future form renders) rather than hard-delete a field
  definition that already has at least one stored value, preserving every previously stored value
  unmodified and unremoved.
- **FR-010**: System MUST NOT require any permission beyond the entity's own existing permission (e.g.
  `department.manage`) to view or submit that entity's custom field values — custom fields are not a
  separately permission-gated layer for ordinary form use.
- **FR-011**: System MUST present a top-level "Settings" sidebar section, distinct from and not nested
  under "Administration," containing Authentication and Forms.
- **FR-012**: System MUST continue to resolve any existing link to the prior Authentication Settings
  location correctly after this reorganization (via redirect if its URL changes).
- **FR-013**: System MUST list, in the tenant-facing Forms screen, only form types that already exist
  (developer-registered) — this list is read-only; no "create form type" action exists anywhere in the
  tenant-facing UI.
- **FR-014**: System MUST visually distinguish global fields (e.g. a "Global" indicator) from
  tenant-added fields wherever both appear together in the tenant-facing configuration screen.
- **FR-015**: System MUST update Department's existing create/edit form (Spec 009) to render and save
  custom field values through this framework — this spec's demoable, end-to-end proof, not deferred
  follow-up work (Clarifications).

### Key Entities

- **Form Type**: A developer-registered kind of form (e.g. "Department," "Training Needs Analysis")
  that other modules build against. Not creatable, renamable, or removable through any admin surface —
  exists only because a module's own code registered it. Attributes: a stable key, a display name, a
  description.
- **Custom Field**: A single additional field attached to a form type — either a global default (set by
  Super Admin, applies to every tenant) or a tenant-specific addition (applies only to the tenant that
  added it). Attributes: label, a stable key (unique per form type, across both global and tenant
  scopes), field type, options (for select/multiselect types), whether it's required, its display
  order, who created it (Super Admin or a tenant admin), and whether it's archived.
- **Custom Field Value**: One entity's stored answer for one custom field — e.g. this specific
  Department's value for the "Cost Center" field. Tied to the entity it belongs to (whichever
  department/TNA-submission/etc. record), the field it answers, and the tenant that owns the entity.
  Untouched when its field is archived.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Tenant Admin can add a new custom field to an existing form type and see it live on
  that form in the same session, with no engineering involvement.
- **SC-002**: 100% of attempts — via the UI or a direct API call — by a non-Super-Admin user to edit,
  delete, or reorder a global field are rejected.
- **SC-003**: 100% of attempts to save a field whose key collides with an existing field (global or
  tenant-owned) on the same form are rejected before anything is written.
- **SC-004**: Every render of a given entity's form shows the same system-fields-then-global-then-tenant
  order, with zero duplicate fields, on every load.
- **SC-005**: 0% of previously stored custom field values are lost or altered when their field is
  archived.
- **SC-006**: The set of form types available in the tenant-facing Forms screen always exactly matches
  what's been developer-registered — zero new form types ever appear without a code change.
- **SC-007**: Every existing bookmark or link to the prior Authentication Settings location continues
  to resolve correctly after this change ships.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema with RLS. `custom_field_values` is straightforwardly
  tenant-scoped like every other tenant-owned table. `form_fields` needs a *dual* policy shape new to
  this codebase: readable by every tenant when it's a global row (no owning tenant) or when it belongs
  to the caller's own tenant, but *writable* only when it belongs to the caller's own tenant (a Super
  Admin writes global rows through the separate platform-level session/policy, not through a tenant
  session at all) — every previous tenant-scoped table in this codebase used one single "belongs to
  caller's tenant" policy for both read and write; this is the first to need read/write asymmetry.
- **Tenant-configurable vs. fixed platform-wide**: A three-way split, the central point of this spec
  (Principle III): form types themselves are fixed platform-wide, never configurable by anyone through
  a UI (only by shipping code). Global default fields are Super-Admin-configurable and apply
  platform-wide until a tenant overrides them with its own addition. Tenant-specific fields are fully
  tenant-configurable, visible only to the tenant that added them.
- **AI-generation review/approval step**: N/A — no AI-generated content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec stores arbitrary custom field values, not
  Results/ROI data. A future Training Needs Analysis spec may store its own data through this framework,
  but any L4/L5 formula concern belongs to that spec, not this one.
- **Downgrade/cancellation behavior**: N/A — this is generic form infrastructure, not a security,
  budget, or evaluation module. Whether custom fields become a plan-tier-gated capability is a future
  packaging decision, not addressed here (see Assumptions).
- **Design system reference**: Uses the established Desktop Shell Visual Language design system —
  Settings > Forms' field list, field builder, and the "Global" indicator reuse existing Card/Badge
  patterns; the field builder is expected to reuse the `Drawer` primitive already established for
  Department Management's create/edit flow (Spec 009), not a new pattern.
- **Demoable vs. internal**: Demoable — a Tenant Admin adding a field and seeing it appear on a real
  form is a complete, visible, end-to-end flow.

## Assumptions

- Department (Spec 009) is the only form type with a real, shipped consumer today; Training Needs
  Analysis is referenced as a future consumer per the feature request but has no spec of its own yet —
  this spec's own demoable flow uses Department as its form type.
- Merged display order keeps global fields collectively ahead of tenant fields on any given form —
  "reorder among tenant-added fields only" (User Story 1) means re-sequencing stays within the tenant
  subset; tenant fields never interleave with or precede global fields, sidestepping any shared-numbering
  conflict between what Super Admin orders and what a tenant orders.
- `options` for `select`/`multiselect` fields is a simple list of plain text choices (each choice's
  stored value and displayed label are the same string) — no separate value/label distinction in v1.
- Viewing Settings > Forms (even read-only, seeing the configured field list) requires
  `forms.manage.tenant` — the feature request names only `forms.manage.global` and
  `forms.manage.tenant`, with no separate view-only permission, unlike the read/manage split used
  elsewhere (e.g. `department.view`/`department.manage`); introducing a new permission key wasn't part
  of the request.
- Whether custom fields (or a higher field count) become an Enterprise/Growth-tier-gated capability
  (Principle VI) is an open packaging question, not decided by this spec — v1 treats the framework as
  available at every tier.
- Per the feature request's explicit framing, the following are flagged as follow-up work, not built
  here: conditional field logic (show field X only if field Y = value); field-level validation beyond
  required/type (e.g. regex, min/max); CSV import mapping to custom fields (planned for a future
  Department CSV Import spec, once this framework exists for it to map into); and the Super Admin
  Console's own "Form Defaults" authoring screen (this spec's data model must support Super Admin
  authoring — FR-002 — but building that screen is a separate future spec).
