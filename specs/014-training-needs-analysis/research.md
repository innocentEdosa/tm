# Research: Training Needs Analysis (TNA)

All Technical Context items were resolvable from the existing codebase (`apps/api`, `apps/web`), the
ratified spec, and the constitution — no open research spike was needed. Each decision below states
what was chosen, why, and what precedent it reuses rather than reinvents.

## 1. `training_needs` RLS: standard single-tenant policy, not the dual-visibility shape

**Decision**: `training_needs` gets exactly the same single `tenant_isolation` policy every other
tenant table uses (`departments`, `custom_field_values`, etc.) — `ENABLE`/`FORCE ROW LEVEL SECURITY`,
one `USING`/`WITH CHECK` on `tenant_id = current_setting('app.tenant_id', true)::uuid`. No dual-
visibility policy (the `form_fields` global-vs-tenant shape from Spec 010) is needed here, because
`training_needs` rows are never global — every row belongs to exactly one tenant and one department.

**Rationale**: The dual-visibility RLS shape exists specifically because `form_fields` rows can be
Super-Admin-authored and readable-but-not-writable by every tenant. `training_needs` has no such
concept — it's a plain tenant-scoped entity table, same as `departments`. Reusing the simple, already-
many-times-precedented policy avoids inventing new RLS surface for no reason.

**Alternatives considered**: A dual-visibility policy was briefly considered in case Draft-privacy
(item 2 below) could be pushed into RLS. Rejected — see item 2.

## 2. Draft-privacy and department-hierarchy scoping: app-layer, not RLS — reuses Team Directory's pattern verbatim

**Decision**: Visibility scoping (which departments a caller can see, and whether Draft rows are
included) is resolved in application code, not RLS, via a new `resolveTrainingNeedVisibilityScope()`
in `apps/api/src/training-needs/training-need-visibility.ts` — a direct structural copy of
`resolveTeamVisibilityScope()` (`apps/api/src/tenant-auth/team-visibility.ts`), calling the same,
unmodified `collectSubtreeIds()` (`apps/api/src/departments/department-hierarchy.ts`):

- `tna.view.all` → scope `{ kind: "all" }`: query returns rows with `status = 'submitted'` across
  every department (Draft rows are never included, regardless of department).
- `tna.view.department` (no `view.all`) → scope `{ kind: "department", departmentIds }`: query
  returns **both** Draft and Submitted rows, but only within `collectSubtreeIds(callerDepartmentId)`.
- No department assigned → scope `{ kind: "no_department_assigned" }`: empty result set, same as Team
  Directory.

**Rationale**: RLS enforces the *tenant* boundary (Principle I); it is not the mechanism this codebase
uses for role/status-based visibility within a tenant — Team Directory already established that
department-subtree and view-all/view-department scoping happens in the route handler via
`resolveTeamVisibilityScope()` + a `WHERE` clause, not a Postgres policy. Doing the same for TNA (a)
reuses a working, tested mechanism instead of inventing a second one, and (b) makes the Draft-privacy
rule (Clarification session Q3) trivial to express as one extra `WHERE status = 'submitted'` condition
on the `{ kind: "all" }` branch — no schema or RLS change required to add it.

**Alternatives considered**: Encoding Draft-privacy as an RLS policy predicate keyed on a
session-level "does this caller hold tna.view.all" flag was rejected — it would require setting a new
Postgres session variable per request solely for this one table, duplicating information the route
handler already has from the permission check it must do anyway to select the correct branch.

## 3. Delete authorization matrix: explicit route-level check, not a database constraint

**Decision**: `DELETE /tenant/training-needs/:id` computes the caller's effective permission
(`tna.manage.all` vs. `tna.manage.department`) the same way every other permission-gated route does
(`requireAnyPermission`), then applies one additional in-handler rule: a `tna.manage.department`-only
caller may delete the row only if `status = 'draft'` **and** the row's `department_id` is within their
subtree; a `tna.manage.all` caller may delete any row regardless of status or department.

**Rationale**: This is a business rule about *which* rows a given permission may delete, conditional on
row state (`status`) — not a structural access boundary, so it belongs in the route handler next to the
visibility-scope check, the same place Department's own delete-blocking-while-children-exist rule
(`department-hierarchy.ts`) lives. No new permission slug is introduced for "delete only my own drafts"
— it is a narrowing of `tna.manage.department` already implied by the spec's Clarification session
Q1.

## 4. `priority` and `status`: `CHECK` constraint columns, matching the `tenants.status` / `departments.status` convention

**Decision**: `priority text NOT NULL CHECK (priority IN ('low','medium','high'))`,
`status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted'))`.

**Rationale**: This is the exact existing convention (`tenants_status_check`,
`departments_status_check` equivalents) — a plain `CHECK`-constrained `text` column, not a Postgres
enum type, consistent with how every other bounded-value column in this schema is already modeled.

## 5. Fixed system fields still get placeholder `form_fields` rows — mirrors Department's `0036` migration exactly

**Decision**: Seed `is_system = true`, `tenant_id = NULL` rows in `form_fields` for `title`,
`priority`, `department_id`, and `status` (mirrring Department's own `0036_seed_department_system_fields.sql`,
which did the same for `name`, `parent_department_id`, `description`, `manager_id`,
`assistant_manager_id`, `status`), so these fixed fields participate in the same unified
`display_order` alongside real tenant custom fields — even though their actual values live in
`training_needs` table columns, not `custom_field_values`, and the client always renders its own
hardcoded control for them (matched by `field_key`), exactly as `department-settings-client.tsx`
already does.

**Rationale**: Consistency with the one precedent this framework already has for "a form type with
both fixed and configurable fields." Deviating (e.g. skipping the placeholder rows) would make TNA's
form ordering behave differently from Department's for no reason.

## 6. Frontend: no new shared custom-fields hook — follow the existing duplicated-inline-pattern precedent

**Decision**: `training-needs-client.tsx` inlines its own fetch-and-render logic for the merged
system+custom field list (`fetch('/tenant-api/tenant/form-fields?formKey=training_needs_analysis...)`,
local `layoutFields`/`customFieldValues` state, a `renderFormField()` switch on `isSystem`), the same
shape `department-settings-client.tsx` and `team-settings-client.tsx` each already independently
implement.

**Rationale**: There is currently no shared `useCustomFields` hook or `<CustomFieldsSection>`
component in this codebase — Department and Team Directory each inline the identical pattern rather
than share one. Introducing a shared abstraction now, on this feature, would be a scope-creeping
architectural change nobody asked for and that neither existing consumer has been migrated to; it's
also the kind of premature abstraction the project avoids. TNA follows the established (if
duplicative) convention rather than deviating from it. If a third near-identical implementation is
judged a good deleveraging opportunity, that is a separate refactor, not part of this feature.

## 7. UI shape: list reuses Team's shape; create/edit is a dedicated full page, not a Drawer — first departure from this codebase's Drawer-for-forms convention

**Decision**: `/learning/tna` renders a filterable list (Team Directory's shape: search/filter bar +
table + pagination for the org-wide HR view). Create/edit is **not** a `Drawer` overlay (unlike every
prior form in this app — Department, Team, Roles) — it is a dedicated route (`/learning/tna/new`,
`/learning/tna/[id]`), a full page with fixed system fields and tenant custom fields laid out in a
two-column grid (`grid grid-cols-1 sm:grid-cols-2`, long-form fields like `textarea`/`multiselect`
spanning both columns via `sm:col-span-2`), matching the `.field-label`/`.field-input` CSS this
codebase already uses per-field — reusing existing field-level styling, introducing only the wrapping
grid, per direct product feedback (2026-07-11 follow-up, after the Drawer version had already shipped
and been verified end-to-end).

**Rationale**: Direct product instruction, given after seeing the Drawer-based version working —
training-need entries carry enough fields (fixed + tenant custom) that a full page reads better than a
side panel, and a two-column layout keeps short fields (Priority, Department, short custom fields)
compact without wasting vertical space. This is the first CRUD sub-route under `(dashboard-shell)`
(mirrors the existing `page.tsx` + `*-client.tsx` split, and the `[state]`-style bracket-folder dynamic
segment already used by `app/tenant-status/[state]/`), and the first two-column form in this codebase
— no prior grid-based form convention existed to deviate from (research confirmed zero `grid-cols`
usage in any existing form across Department/Team/Roles).

## 8. Nav placement: new "Learning" section; existing disabled "Courses" placeholder is left untouched

**Decision**: A new permission-gated `NavSection` ("Learning") is added to
`apps/web/app/(dashboard-shell)/layout.tsx`, following the identical `if (canX) { navSections.push(...) }`
pattern "Administration" already uses, containing one child link: "Training Needs Analysis" →
`/learning/tna`. The existing disabled `{ key: "courses", href: "/courses", disabled: true, tag: "Soon" }`
placeholder in the top `"menu"` section is **not** moved or renamed.

**Rationale**: The spec asked only for a "Learning" section containing the TNA link — folding the
pre-existing Courses placeholder into it is a plausible future consolidation but is out of this
feature's scope and wasn't asked for. Per Constitution Principle VIII, this tradeoff is flagged here
rather than silently expanded or silently ignored: a future Courses feature may want to relocate under
"Learning" too, at which point that spec should make that call explicitly.

## 9. Cross-department detail access returns `404`, not `403`

**Decision**: `GET /tenant/training-needs/:id` returns `404 Not Found` (not `403 Forbidden`) when the
row exists but falls outside the caller's visibility scope (wrong department subtree, or a Draft row
requested by a `tna.view.all`-only caller).

**Rationale**: `404` avoids confirming to an unauthorized caller that a given ID exists in another
department at all — a slightly stronger information-disclosure posture than `403`, and a reasonable
default in the absence of an existing precedent either way in this codebase (Department/Team's
permission-gating tests assert `403` at the collection level for missing permissions entirely, a
different case from "have some TNA permission, but this specific row is out of scope").
