# Quickstart: Validating the Training Request Rename

Prerequisites: local Postgres running with the existing dev database migrated up through this
feature's new migration (`0057_rename_tna_permissions_to_training_request.sql`), `apps/api` and
`apps/web` running locally (`pnpm dev` from repo root, or per-app `pnpm dev`), and at least one
tenant seeded with a role that held one or more of the old `tna.*` permissions before you apply the
migration (use an existing dev tenant that already exercises Feature 014, or seed one via the
existing `hr_admin`/`manager` role templates per `0050_seed_tna_permissions.sql`).

## 1. Permission continuity (User Story 2 / SC-002 — do this first, before other checks)

1. Before running the new migration, note the current effective permissions of a test tenant's
   `HR/L&D Admin`-sourced role and `Manager`-sourced role (via the Roles Management UI,
   `/settings/roles`, or a direct query: `SELECT p.key FROM role_permissions rp JOIN permissions p
   ON p.id = rp.permission_id WHERE rp.role_id = '<role-id>'`).
2. Run `pnpm --filter api db:migrate` to apply `0057_rename_tna_permissions_to_training_request.sql`.
3. Re-check the same role's effective permissions. **Expected**: the same number of permission rows,
   now showing `training_request.*` keys instead of `tna.*` — same role, same count, only the label
   changed. No `role_permissions` or `role_template_permissions` row was deleted or inserted (spot
   check row counts on both tables before/after — they must be identical).
4. As a user holding that role, attempt the same actions you could before (view the list, view a
   department's entries, approve an entry, etc., depending on which key(s) the role held).
   **Expected**: identical access to before the migration — nothing newly denied, nothing newly
   allowed.
5. This exact check is also automated in
   `apps/api/tests/integration/training-request-permission-migration.test.ts` — run
   `pnpm --filter api test training-request-permission-migration` to verify it passes.

## 2. User-facing labeling (User Story 1 / SC-001)

1. Log in as a user whose role holds any of the five renamed permissions.
2. Confirm the sidebar shows "Learning" → "Training Requests" (not "Training Needs Analysis").
3. Open the list page, the create form, and an existing entry's detail/edit page. **Expected**:
   every heading, breadcrumb, empty state, and button/confirmation copy reads "Training Request(s)".
4. Trigger a notification this feature sends (e.g. submit an entry, or approve one, if
   email/notification wiring exists for this feature). **Expected**: subject/body use "Training
   Request" terminology.

## 3. Route rename and redirect (User Story 3 / SC-003)

1. With the app running, visit the old URL directly in a browser: `/learning/tna`. **Expected**:
   redirected to `/learning/training-requests`, list renders normally.
2. Visit `/learning/tna/new`. **Expected**: redirected to `/learning/training-requests/new`.
3. Take an existing entry's id and visit `/learning/tna/<id>` and `/learning/tna/<id>/edit`.
   **Expected**: redirected to `/learning/training-requests/<id>` and
   `/learning/training-requests/<id>/edit` respectively, showing that same entry.

## 4. Regression check (SC-004)

Run the full existing test suite for this feature and confirm it still passes after the key/route
rename: `pnpm --filter api test training-needs` (covers the renamed-literal test files) and
`pnpm --filter api test training-request` (covers the new migration test). No behavioral test
(submission, editing, approval, visibility scoping) should need a logic change — only the
permission-key string literals asserted against.
