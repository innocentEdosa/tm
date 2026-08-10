# Quickstart: Validating the Form Builder

Prerequisites: local Postgres running (`pnpm docker:up` per repo scripts), migrations applied,
`apps/api` and `apps/web` dev servers running (`pnpm dev` from repo root), a Super Admin session
and at least one tenant with a Tenant Admin user (existing seed data / provisioning flow).

## 1. Migration correctness (User Stories 1 & 4 prerequisite)

```bash
pnpm --filter api drizzle-kit migrate   # applies the new 0107+ migrations
```
Then, against the dev DB:
```sql
select count(*) from form_fields where tenant_id is null and form_version_id is null;
-- expect 0 — every platform field backfilled into version 1
select key, active_version_id from form_definitions;
-- expect department / member / training_needs_analysis all have a non-null active_version_id
```
Open the existing Department, Member, and Training Needs Analysis pages and confirm they render
and save exactly as before migration — this proves FR-033/FR-034 (non-destructive, no consumer
broken by the schema change alone, before any consumer is migrated to the new renderer).

## 2. Super Admin builds and publishes a form (User Story 1)

1. As Super Admin, open the Form Builder for the "Department" form type.
2. Add a new field ("Cost Code", text, optional, 6-column width) into the existing default
   section; confirm the live preview updates immediately (`GET /platform/forms/:id/versions/:versionId`
   round-trips through `<FormPreview>`).
3. Publish. Confirm `form_definitions.active_version_id` now points at the new version and the
   prior version's `status` is `archived` (contracts/form-builder-api.md publish behavior).
4. Open the Department create/edit screen as an ordinary tenant user (once migrated per User
   Story 1's own acceptance scenario 3) and confirm "Cost Code" appears, in the configured
   position and column width, with no code change to `department-settings-client.tsx` beyond the
   swap to `<FormRenderer>`.

## 3. Multi-step wizard (User Story 2)

Build a test form (or a new form type) with 3 steps, at least one required field per step.
Confirm: cannot advance past a step with the required field empty; optional step is skippable;
data entered on step 1 survives navigating to step 3 and back.

## 4. Tenant extension and isolation (User Story 3)

As Tenant A's Tenant Admin: add a tenant field, hide one optional platform field. As Tenant B's
Tenant Admin: confirm neither change is visible, and Tenant B can independently add/hide its own
fields without affecting Tenant A. As Super Admin: confirm the base published version is
unchanged by either tenant's actions. Attempt (via direct API call, not just UI) to hide a
required/system field as a Tenant Admin and confirm `403`.

## 5. Consumer migration parity (User Story 4)

For each of Department, Member, and Training Needs Analysis after migration:
```bash
grep -rn "renderSystemField\|renderCustomField\|renderField" apps/web/app/\(dashboard-shell\)/settings/department apps/web/app/\(dashboard-shell\)/settings/team "apps/web/app/(dashboard-shell)/learning/training-requests"
```
Expect zero matches (SC-005). Exercise each page's create/edit/submit flow manually and confirm
unchanged behavior, including Training Needs Analysis's draft → submitted → approved workflow.

## 6. Runtime form-type creation (User Story 5)

As Super Admin, create a form type through the UI with a new key (no migration file added to the
repo), build a minimal published version, and confirm `GET /tenant/forms/:key/effective` returns
it — proving FR-001/FR-026 without any code deployment.

## 7. Version history & reconciliation (User Story 6)

Publish v1 of a test form, have a tenant add a field into one of its sections, publish v2 with
that section's key removed. Confirm: the tenant's field is preserved (not deleted), flagged
`needsReview: true` in the effective form response; a record submitted under v1 still displays
correctly using v1's field definitions (`custom_field_values.form_version_id`).

## Automated coverage

- `packages/form-builder/src/components/FormRenderer/validate-field.test.ts` — required/type
  validation logic (the same checks that gate step navigation and submission). Run with
  `pnpm --filter @tm/form-builder test` — no database needed, passes in any environment.
- `apps/api/tests/integration/form-builder-publish-and-effective-form.test.ts` — publish
  atomicity, duplicate form-type key rejection, effective-form field ordering.
- `apps/api/tests/integration/form-builder-visibility-and-isolation.test.ts` — tenant isolation
  (Tenant A/B cross-visibility), required-field-hide rejection via direct API call.
- `apps/api/tests/integration/form-builder-version-reconciliation.test.ts` — tenant customization
  carried forward vs. flagged `needsReview` on republish; a stored value's `form_version_id`
  staying pinned to the version active when it was captured.
- All three `apps/api` integration files need a reachable Postgres (`pnpm docker:up` then
  `pnpm --filter api db:migrate`) — run with `pnpm --filter api test`. They were written and
  type-checked but not executed during this feature's implementation (no local Postgres was
  running in that environment).

## Admin Usage Guide

### For a Super Admin: building and publishing a form

1. Open **Platform Forms** (`/platform/forms` in the Super Admin console) — a paginated,
   searchable list of every form type.
2. To configure an existing form type (e.g. "Department"), click its row to open the builder at
   `/platform/forms/:id` — if it has no draft in progress, click **New draft** (this clones the
   currently published version as your starting point, or starts empty for a form type that's
   never been published).
3. To add a brand-new form type, click **Create form** at the top of the list — give it a name,
   key, and description. It's available to configure immediately; no engineering or deployment
   involved.
4. Use **Add step** / **Add section** to organize the form (skip both for a simple single-section
   form — most existing forms, like Department, don't use steps at all). Use **Add field** to add
   a field: label, type, description/placeholder, options (for select/radio/multi-select),
   required flag, and column width (1–12, on a 12-column grid).
5. The right-hand **Live preview** panel always reflects your current draft, rendered through the
   exact same `<FormRenderer>` end users see — what you see here is what they'll see.
6. Click **Publish** when ready. This is atomic and immediate: the draft becomes the active
   version for every tenant, and whatever was previously published is retired to "Archived" in
   the version history below — there's never a moment where two versions are both live, or where
   your draft leaks to production before you click Publish.
7. To revise an already-published form later, use **New draft** (or **New draft from this
   version** next to any entry in Version history) rather than editing published fields directly
   — published/archived versions are immutable by design, so historical records stay
   interpretable against whichever version was active when they were created.

### For a Tenant Admin: extending a form for your organization

1. Open **Settings > Forms**, select the form type you want to extend.
2. Click **Add field** to add a field only your organization sees — it never affects the platform
   default or any other tenant, and appears immediately, with no approval step.
3. To remove a platform-provided field your organization doesn't need, open its row menu and
   choose **Hide** — this only works for optional platform fields; a required or built-in field
   has no Hide option because the platform doesn't allow it (enforced by the server, not just
   hidden in this screen — a direct API attempt is rejected the same way).
4. Drag any field (including built-in ones) to reorder the whole form for your organization.
5. The **Live preview** panel shows exactly what your organization's users will see, hidden
   fields excluded — this is the same renderer the real form uses, not a separate preview.

### For a developer: consuming a form in a new feature

See `packages/form-builder/README.md` — the short version is `useEffectiveForm(formKey,
subdomain)` + `<FormRenderer>`, with no field-type switch, merge logic, or validation to write
yourself.
