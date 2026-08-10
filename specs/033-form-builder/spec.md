# Feature Specification: Reusable Form Builder & Form Renderer

**Feature Branch**: `033-form-builder`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "Reusable Form Builder & Form Renderer infrastructure — evolve the existing Extensible Custom Fields Framework (spec 010: form_definitions, form_fields, form_field_order_overrides, custom_field_values, getFormFields(), validateCustomFieldValues(), saveCustomFieldValues()) into a proper dynamic Form Builder usable by Super Admin (platform-level) and Tenant Admins. Core concept: Form Type → Form Definition → Form Builder → Published Version → Feature consumes the active/effective form via getEffectiveForm(formKey) + a single shared <FormRenderer>. Super Admin must be able to create entirely new form types at runtime (no migration required), configure fields/layout/steps/sections, and publish versions. Tenant Admins extend the platform's published form with their own tenant-only fields and may hide (never delete) optional platform fields, but can never touch required/system fields, another tenant's fields, or the platform's base form. Support multi-column layout, multi-step/wizard forms, sections/groups, draft/published/archived lifecycle with versioning, and a single shared FormRenderer used identically by the builder's preview and every real consuming feature (Department, Member, Training Needs Analysis, and future ones). The Form Builder must control presentation only, never become the domain persistence layer — each feature keeps its own service/table for submitted data. All tenant-isolation and field-ownership/deletion rules enforced server-side. Migrate existing Department, Member, and Training Needs Analysis forms onto this infrastructure without losing existing data, rolling out incrementally."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Super Admin builds and publishes a working form, a feature renders it (Priority: P1)

A Super Admin opens the Form Builder for an existing form type (e.g. "Department"), arranges
fields into a multi-column layout with labeled sections, and publishes it. The Department page,
without any custom rendering code of its own, immediately shows the published form to every
tenant exactly as the Super Admin designed it.

**Why this priority**: This is the entire value proposition end to end — without it, nothing else
in this feature matters. It proves form type/version/field/section/layout data model, the
publish lifecycle, the shared renderer, and effective-form resolution all work together on one
real, already-shipped consumer.

**Independent Test**: As a Super Admin, edit the "Department" form's field layout and sections,
publish it, then open the Department create/edit screen as an ordinary tenant user and confirm
the new layout, sections, and fields render exactly as configured — with zero custom rendering
code left in the Department page.

**Acceptance Scenarios**:

1. **Given** a Super Admin editing a draft version of an existing form, **When** they add a
   field, set its label/type/required flag/column width, and place it in a section, **Then** the
   field appears in the live preview exactly as it will render for end users.
2. **Given** a draft version with at least one section and no unresolved errors, **When** the
   Super Admin publishes it, **Then** it immediately becomes the version every tenant's form
   requests resolve to, and any previously published version stops being served.
3. **Given** a published form with multiple sections and a 2-column layout, **When** any
   application feature requests that form and renders it with the shared renderer, **Then** the
   rendered output matches the builder's own preview exactly — same fields, same order, same
   columns, same sections.
4. **Given** a required field with no submitted value, **When** a user attempts to submit the
   form, **Then** submission is rejected with a field-level error, both in the UI and if the same
   incomplete data is submitted directly to the API.

---

### User Story 2 - Super Admin builds a multi-step wizard form (Priority: P2)

A Super Admin organizes a form's fields into multiple steps (e.g. "Basic Information",
"Employment", "Review & Submit"), each with its own title, description, and optional flag. Users
filling out the form move through the steps one at a time, with each step's required fields
validated before advancing.

**Why this priority**: Wizard-style forms are explicitly required for larger forms (e.g. future
onboarding flows) but are an enhancement on top of the single-step case proven in User Story 1 —
a working single-step form is independently valuable without this.

**Independent Test**: Configure a form with 3 steps, each containing at least one required field;
as an end user, confirm you cannot advance past a step with an unfilled required field, can
navigate back to a previous step without losing entered data, and reach a final review step
before submitting.

**Acceptance Scenarios**:

1. **Given** a form with steps configured, **When** a user opens it, **Then** they see only the
   current step's fields, with clear progress/navigation between steps.
2. **Given** a step marked optional, **When** a user skips it, **Then** they can still reach
   later steps and submit successfully.
3. **Given** a step with an unmet required field, **When** the user tries to advance, **Then**
   they're blocked with a clear error on that field, without losing already-entered data on other
   steps.
4. **Given** a Super Admin reorders, renames, or removes a step in a draft version, **When** they
   preview it, **Then** the preview reflects the change immediately, and the currently published
   version (if any) is unaffected until this draft is published.

---

### User Story 3 - Tenant Admin extends a published form without touching the platform's copy (Priority: P3)

A Tenant Admin opens their tenant's view of a published form (e.g. "Department"), adds a field
their organization needs (e.g. "Cost Centre") that no other tenant sees, and hides an optional
platform-provided field their organization doesn't use. The platform's base form and every other
tenant's experience remain completely unchanged.

**Why this priority**: This is the multi-tenant value proposition layered on top of the Super
Admin's base form (User Stories 1–2) — without it, every tenant is stuck with exactly what the
Super Admin built, which is the same limitation the pre-existing Custom Fields Framework already
solved for a narrower case and must not regress.

**Independent Test**: As a Tenant Admin, add a tenant-only field and hide one optional platform
field on a published form; confirm your tenant's users see the change, a second tenant's users
see neither the added field nor the hidden one restored, and the Super Admin's own view of the
base form is unchanged.

**Acceptance Scenarios**:

1. **Given** a published form, **When** a Tenant Admin adds a field, **Then** it appears only on
   that tenant's rendering of the form, saved and visible without requiring any Super Admin
   action.
2. **Given** an optional platform-provided field, **When** a Tenant Admin hides it, **Then** it
   stops appearing on that tenant's form while remaining visible on every other tenant's form and
   unchanged in the Super Admin's base form.
3. **Given** a required or system-designated field, **When** a Tenant Admin attempts to hide or
   remove it — through the UI or a direct API call — **Then** the attempt is rejected.
4. **Given** two tenants who have each customized the same published form differently, **When**
   either tenant's users open the form, **Then** each sees only their own tenant's customizations,
   never the other's.

---

### User Story 4 - Member and Training Needs Analysis consume the same infrastructure (Priority: P4)

The Member form and the Training Needs Analysis form are migrated onto the same form
type/version/effective-form/renderer path already proven for Department, with their existing
duplicated field-rendering code removed entirely.

**Why this priority**: Proves the infrastructure genuinely generalizes beyond a single consumer
and eliminates the duplication the original audit identified — necessary for "reusable" to be
true, but dependent on User Stories 1–3 already working.

**Independent Test**: Open the Member and Training Needs Analysis create/edit screens after
migration and confirm both continue to work exactly as before (including each screen's own
domain-specific behavior — e.g. Training Needs Analysis's draft/submitted/approved workflow),
with no `renderField`/`renderSystemField`/`renderCustomField` switch statements remaining in
either page's source.

**Acceptance Scenarios**:

1. **Given** the Member form after migration, **When** an admin creates or edits a member,
   **Then** all existing system and custom fields behave exactly as before migration.
2. **Given** the Training Needs Analysis form after migration, **When** a user saves a draft or
   submits it, **Then** the existing draft/submitted/approved workflow and required-field
   enforcement on submit continue to work unchanged.
3. **Given** the codebase after this story is complete, **When** any of the three migrated pages
   is inspected, **Then** it contains no page-local field-type rendering switch — only a call to
   retrieve the effective form and render it with the shared renderer.

---

### User Story 5 - Super Admin creates a brand-new form type without a code deployment (Priority: P5)

A Super Admin creates a form type that did not exist before (e.g. "Employee Onboarding"),
configures its fields, layout, and steps through the Form Builder, and publishes it — all without
any engineer writing code or running a database migration.

**Why this priority**: This is the "no developer required for a new form type" capability the
feature is ultimately building toward, but it depends on the full builder (User Stories 1–2)
already existing and is only meaningful once at least one real feature (User Story 4's pattern)
demonstrates how a new feature wires itself up to consume a form — so it's sequenced last among
the builder capabilities.

**Independent Test**: As a Super Admin, create a new form type through the UI, build and publish
a form for it, and confirm it is immediately retrievable by key through the same effective-form
mechanism every other form type uses — with no migration file added to the codebase for it.

**Acceptance Scenarios**:

1. **Given** the Form Builder's form type list, **When** a Super Admin creates a new form type
   with a name, key, and description, **Then** it appears immediately as a configurable form,
   with no application restart or deployment required.
2. **Given** a newly created form type, **When** the Super Admin builds and publishes a version
   for it, **Then** requesting that form by key returns the published version exactly like any
   pre-existing form type.
3. **Given** a form type key that already exists, **When** a Super Admin attempts to create
   another form type with the same key, **Then** the attempt is rejected with a clear message.

---

### User Story 6 - Form versions preserve history and never surprise a tenant (Priority: P6)

A Super Admin makes a significant change to an already-published form by creating a new draft
version from it, and publishes it once ready. Tenants who had customized the previous version
keep their customizations wherever the new version still has an equivalent place for them, and
records already submitted under the old version remain fully readable against the version that
was active when they were captured.

**Why this priority**: Matters once a form has been live long enough to need real revision — a
polish/maturity requirement on top of the core loop (User Story 1), not needed for the very first
version of any given form to go live.

**Independent Test**: Publish version 1 of a form, have a tenant customize it, publish version 2
with one section renamed and one section removed, and confirm the tenant's customizations in the
still-present section carry forward automatically while customizations tied to the removed
section are flagged for the tenant's review rather than silently lost or silently hidden; then
open a record submitted under version 1 and confirm its field labels and values still resolve
correctly.

**Acceptance Scenarios**:

1. **Given** a published form version, **When** a Super Admin edits it, **Then** the edit happens
   on a new draft version, and the currently published version keeps serving every tenant
   unchanged until the new draft is explicitly published.
2. **Given** a form with more than one historical version, **When** a past submission is viewed,
   **Then** it displays using the field definitions of the version that was active when it was
   submitted, not the currently active version.
3. **Given** a tenant's customization anchored to a section that no longer exists in a newly
   published version, **When** that tenant's form is next rendered, **Then** the customization is
   preserved (not deleted) and surfaced for the Tenant Admin's review rather than silently
   dropped or silently misplaced.

---

### Edge Cases

- What happens when a form type has zero configured fields at all? It renders with only its
  fixed system fields (or nothing, if it has none), exactly as if the framework didn't exist —
  no empty section, no broken layout, matching the existing Custom Fields Framework's behavior.
- What happens when a Tenant Admin tries to add a field whose key collides with an existing
  platform field's key on the same form? Rejected — field-key uniqueness is enforced across
  platform and tenant scopes together, not just within the tenant's own fields.
- What happens if a Super Admin tries to publish a draft version with no sections or with a step
  that has no fields? Rejected with a clear validation message before anything becomes active.
- What happens to a tenant's already-submitted records when a newly published version adds a new
  required field? Not retroactively invalidated — required-field validation applies only when
  that specific record is next created or edited.
- What happens if two Super Admins edit the same draft version at the same time? The later save
  wins for whatever it touched; this spec does not require field-level collaborative locking.
- What happens when a Tenant Admin's role loses its form-management permission after they've
  already added fields or hidden platform fields? Their existing customizations remain exactly as
  they are (visible, functioning) — losing the permission only removes the ability to change them
  further.
- What happens if a Tenant Admin tries to reorder a platform field ahead of another tenant's
  visibility of that same field? Not possible — reordering and hiding are always scoped to the
  acting tenant only and never affect any other tenant's rendering.
- What happens when a system (entity-required) field would need to move between sections/steps
  during a republish? Its position can move with the rest of the layout, but its existence,
  required status, and validation are never affected — those remain owned by the consuming
  feature's own code, not the form definition.
- What happens if a consuming feature requests a form type that doesn't exist or has never been
  published? A clearly empty/not-found result is returned rather than an error that breaks the
  requesting page — the feature decides how to degrade (e.g. show only its system fields).

## Requirements *(mandatory)*

### Functional Requirements

**Form types**

- **FR-001**: System MUST allow a Super Admin to create a new form type at runtime — with a name,
  a stable key, and a description — without requiring a code change or database migration.
- **FR-002**: System MUST reject creation of a form type whose key already exists.
- **FR-003**: System MUST allow a Super Admin to edit a form type's name/description/icon and to
  archive a form type, without allowing its key to change once created.
- **FR-004**: System MUST NOT allow any Tenant Admin, through any interaction path, to create,
  rename, or archive a form type.

**Form building & versioning**

- **FR-005**: System MUST allow a Super Admin to create a draft version of a form type, either
  starting empty or cloned from an existing version's steps/sections/fields/layout.
- **FR-006**: System MUST allow a Super Admin to add, edit, remove, and reorder fields, sections,
  and steps within a draft version, with changes reflected in a live preview before publishing.
- **FR-007**: System MUST allow a Super Admin to publish a draft version only when it passes
  validation (at least one section; no step or section left completely empty is allowed to block
  publish only if the Super Admin has not explicitly marked it optional/empty-permitted).
- **FR-008**: System MUST ensure that publishing a version makes it the sole active version for
  that form type going forward, and automatically retires the previously active version to an
  archived state — never leaving two versions simultaneously active.
- **FR-009**: System MUST NOT allow edits to a published or archived version directly — changes
  require creating and publishing a new draft version.
- **FR-010**: System MUST preserve every historical version of a form type indefinitely, and MUST
  be able to resolve which version was active at the time any given past record was submitted.
- **FR-011**: System MUST NOT allow a draft version to affect what any tenant-facing feature
  currently renders until it is explicitly published.

**Field configuration**

- **FR-012**: System MUST support at minimum these field types: single-line text, multi-line
  text, number, email, URL, date, date/time, single-select, multi-select, radio, checkbox,
  toggle, and file upload (file upload only for form types whose consuming feature has file
  storage already integrated).
- **FR-013**: System MUST allow each field to be configured with: label, a stable field key,
  description/help text, placeholder text, required/optional status, a default value, options
  (for select/radio/multi-select types), basic validation constraints (e.g. minimum/maximum,
  pattern) where applicable to the field type, display order, column width/span, and visibility.
- **FR-014**: System MUST enforce field-key uniqueness for a given form type across platform
  fields and a tenant's own fields together — no two fields visible on the same rendered form may
  share a key.
- **FR-015**: System MUST distinguish three field ownership levels — system (fixed, owned by the
  consuming feature's own code, never editable through the Form Builder), platform (authored by a
  Super Admin, applies to every tenant by default), and tenant (authored by one Tenant Admin,
  visible only to that tenant) — and MUST make this ownership visible wherever fields are listed
  for management.

**Layout, steps, and sections**

- **FR-016**: System MUST allow fields to be arranged in a multi-column layout within a section,
  with each field's column width independently configurable, and MUST render that layout
  consistently everywhere the form is consumed.
- **FR-017**: System MUST allow a form version to be organized into zero or more steps, each with
  its own title, description, display order, and an optional/required-to-complete flag.
- **FR-018**: System MUST allow a form version to be organized into sections (either within a
  step or, if the version has no steps, directly within the form), each with its own title,
  description, display order, and set of fields.
- **FR-019**: System MUST validate a step's required fields before allowing navigation to the
  next step, when the form is presented as a wizard.

**Tenant extension**

- **FR-020**: System MUST allow a user holding the existing tenant form-management permission to
  add, edit, reorder, and archive fields scoped only to their own tenant, on any form type.
- **FR-021**: System MUST allow that same user to hide an optional, non-system, platform-provided
  field from their own tenant's rendering of a form, without deleting or altering the underlying
  platform field definition in any way.
- **FR-022**: System MUST reject any attempt — via the UI or a direct API call — by a Tenant
  Admin to hide, edit, delete, or reorder a field marked required or system-owned, regardless of
  who is attempting it.
- **FR-023**: System MUST reject any attempt by a Tenant Admin to edit, delete, or reorder a
  platform field's own definition (label, type, options, etc.) — a Tenant Admin may only add
  their own fields and control the visibility/position of platform fields within their own
  tenant's view.
- **FR-024**: System MUST scope every tenant customization (added fields, hidden fields, position
  overrides) to the acting tenant only, invisible to and unaffected by any other tenant, enforced
  at the data layer, not only hidden in the UI.
- **FR-025**: System MUST carry a tenant's existing customizations forward automatically when a
  new version of a form is published, matching them to the new version's equivalent step/section
  where one still exists, and MUST flag (not silently drop or silently hide) any customization
  whose anchor point no longer exists in the new version.

**Rendering & consumption**

- **FR-026**: System MUST provide a single mechanism any application feature can call, given a
  form type's key, to retrieve the fully resolved form a specific tenant should see — combining
  the feature's own fixed system fields, the currently published platform version, and that
  tenant's own overrides and added fields, in final display order.
- **FR-027**: System MUST provide a single shared rendering mechanism that renders any resolved
  form — every supported field type, required/optional state, validation and errors, sections,
  multi-column layout, steps with navigation, read-only/preview mode, loading state, and
  submitting state — such that no consuming feature page needs to implement its own field-type
  rendering logic.
- **FR-028**: System MUST use the exact same rendering mechanism for the Form Builder's own
  preview (both Super Admin and Tenant Admin) as for every real, live-consuming feature page, so
  that what an admin sees while building is what an end user sees while filling it out.
- **FR-029**: System MUST allow a consuming feature to supply its own custom rendering for a
  specific field key (for cases where a system field needs feature-specific behavior beyond a
  generic input, e.g. a person-search control) without requiring a fork of the shared renderer.
- **FR-030**: System MUST validate a submitted value against its field's configured type,
  required status, and any configured validation constraints on every submission, independent of
  the consuming feature's own domain validation.

**Data & submission boundary**

- **FR-031**: System MUST NOT persist a consuming feature's own domain data (e.g. a Department's
  name, a Member's employment status) — the Form Builder is responsible only for field
  definitions, layout, and the values of platform/tenant custom fields; each consuming feature
  remains responsible for persisting its own entity's data through its own existing service.
- **FR-032**: System MUST record, for every stored custom field value, which form version was
  active at the time it was captured, so that a historical record's fields remain interpretable
  even after the form has since been republished.

**Migration**

- **FR-033**: System MUST migrate all existing form types (Department, Member, Training Needs
  Analysis) and their existing fields and stored custom field values into the new version/step/
  section model without any data loss, and without requiring any tenant to reconfigure anything
  that already worked before this feature shipped.
- **FR-034**: System MUST continue to serve existing consuming pages correctly at every
  intermediate stage of migration — a page not yet migrated to the shared renderer must keep
  working exactly as it did before this feature began, until its own migration story is complete.

### Key Entities

- **Form Type (Form Definition)**: A named, keyed kind of form (e.g. "Department", "Employee
  Onboarding") that a feature is built against. Created and owned by a Super Admin; a Tenant
  Admin may configure its own extensions to it but never creates or renames a form type itself.
- **Form Version**: One buildable/publishable snapshot of a form type's structure — its steps,
  sections, fields, and layout — in one of three states (draft, published, archived). Exactly one
  version per form type is published (active) at a time; every version is preserved indefinitely
  for historical traceability.
- **Form Step**: An ordered, optionally-skippable stage within a form version, with its own
  title, description, and set of sections/fields, used when a form is presented as a wizard.
- **Form Section**: A named, ordered group of fields within a form version (optionally within a
  step), used to visually organize related fields together.
- **Form Field**: A single configurable field — attributes: label, stable key, type, description/
  help text, placeholder, required flag, default value, options (where applicable), validation
  constraints, display order, column width, ownership (system/platform/tenant), and (for
  tenant-owned fields) the owning tenant.
- **Tenant Form Override**: One tenant's customization of a platform field's position or
  visibility within their own rendering of a form — never a modification of the platform field's
  own definition.
- **Custom Field Value**: One entity's stored answer for one platform or tenant field, tied to the
  entity it belongs to, the field it answers, the owning tenant, and the form version that was
  active when it was captured.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can create a brand-new form type and have it available to configure
  in the Form Builder within the same session, with no engineering involvement or deployment.
- **SC-002**: A Super Admin can build and publish a form with at least 2 sections, a 2-column
  layout, and 10 fields without needing help from an engineer.
- **SC-003**: What a Super Admin or Tenant Admin sees in the builder's preview matches what an
  end user sees on the live form 100% of the time — verified by rendering the same form
  definition through the same mechanism in both places.
- **SC-004**: 100% of existing Department, Member, and Training Needs Analysis field
  configurations and previously stored values remain intact and correctly displayed after
  migration.
- **SC-005**: Zero page-local field-rendering switch statements remain in any consuming feature
  page once its migration story (User Story 4) is complete.
- **SC-006**: 100% of attempts — via the UI or a direct API call — to hide, edit, or delete a
  required or system field by a non-Super-Admin user are rejected.
- **SC-007**: 100% of attempts by one tenant to view or modify another tenant's form
  customizations are rejected.
- **SC-008**: 0% of drafts become visible to end users before being explicitly published; 100% of
  publishes atomically retire the prior active version with no window where two versions are both
  active.
- **SC-009**: A record submitted under an older form version remains fully readable (correct
  field labels and values) after the form has since been republished with a different structure.
- **SC-010**: A Tenant Admin can add a custom field to a published form and see it live for their
  own tenant's users in the same session, with zero effect on any other tenant.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema with RLS, extending the existing
  `custom_field_values`/`form_fields` tenant-isolation approach. New platform-level tables (form
  versions, steps, sections) follow the same "readable by every tenant, writable only by a
  verified Super Admin session" pattern already used elsewhere in this codebase for other
  platform-owned tables; tenant-owned customization rows keep the existing tenant-scoped
  read/write RLS shape unchanged.
- **Tenant-configurable vs. fixed platform-wide**: Directly implements Principle III. Form
  *types* remain Super-Admin-owned (not tenant-creatable) but move from developer/migration-only
  to Super-Admin-runtime-configurable — a genuine expansion of platform-level configurability.
  Platform field/layout/step/section definitions within a published form are Super-Admin
  configurable and apply to every tenant by default. Tenant-added fields and tenant visibility/
  position overrides are fully tenant-configurable and apply only to the tenant that set them.
  System (entity-required) fields remain fixed, owned by each consuming feature's own code, never
  configurable by anyone through this framework.
- **AI-generation review/approval step**: N/A — no AI-generated content is involved.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature stores form structure and
  arbitrary field values, not Results/ROI data. Training Needs Analysis may store its own data
  through this framework, but any L4/L5 formula concern belongs to that feature, not this one.
- **Downgrade/cancellation behavior**: N/A for this spec — whether the Form Builder (or a higher
  field/form-type count) becomes a plan-tier-gated capability is an open packaging decision,
  carried forward unresolved from the original Custom Fields Framework spec, not decided here.
- **Design system reference**: Uses the established design system exclusively — no new UI
  components, colors, or patterns are introduced. The builder reuses existing primitives (Card,
  Drawer, Modal, Button, Input, Toggle, Badge, Popover) and the already-adopted drag-and-drop
  interaction pattern used elsewhere in the product for reorderable lists.
- **Demoable vs. internal**: Demoable — a Super Admin building and publishing a form live, and a
  Tenant Admin extending it, are both directly visible, stakeholder-demoable flows.

## Assumptions

- Tenant customizations (added fields, hidden fields, reordering) take effect immediately upon
  save for that tenant, matching the existing Custom Fields Framework's current behavior — they
  do not require a separate tenant-level draft/publish approval step. Only the platform-authored
  base form has a draft/publish lifecycle.
- File upload fields are only offered as a configurable type for form types whose consuming
  feature already has file storage integrated (mirroring how the rest of the platform handles
  file attachments today) — this feature does not introduce a new general-purpose file store.
- Creating a new form type through the Form Builder makes the *form* (its structure and
  presentation) available with no code change, per FR-001; wiring a genuinely new domain entity's
  own persistence (e.g. a brand-new "Role" record type with its own table) still requires that
  feature's own service/domain code, consistent with the Form Builder never becoming the
  persistence layer (FR-031). This capability applies fully, without any extra engineering, to
  new forms attached to entities/services that already exist.
- No new third-party package is required for this feature — the drag-and-drop interaction already
  used elsewhere in this codebase for reorderable lists, and the existing shared design-system
  package, are reused rather than introducing a new dependency, per the project's dependency
  discipline.
- Rollout proceeds incrementally by user story priority (P1 through P6 above) rather than as one
  simultaneous change, consistent with not disrupting the three form types already in production
  use.
- The existing tenant form-management permission continues to gate all Tenant Admin actions in
  this feature; Super Admin actions continue to be gated by the existing Super Admin session
  mechanism already used for every other platform-only surface in this codebase — no new
  permission concept is introduced.
