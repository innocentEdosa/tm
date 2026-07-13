# Quickstart: Training Needs Analysis (TNA)

Validation guide for the flows described in spec.md's three user stories. Assumes a local dev
environment (`pnpm dev`, migrations applied through `0049_seed_tna_permissions.sql` per plan.md) with
a tenant seeded with at least one `hr_admin`-role user, one `manager`-role user whose `departmentId`
points at a real department, and a second department the manager does **not** belong to.

## Prerequisites

1. `pnpm --filter api db:migrate` — applies `training_needs` table, RLS policy, `form_definitions` row,
   `is_system` `form_fields` rows, and the four `tna.*` permissions (data-model.md).
2. `pnpm dev` — runs both `apps/api` and `apps/web`.
3. Log in as the seeded HR/L&D Admin and Manager (two sessions, e.g. two browser profiles).

## Scenario 1 — HR/L&D Admin adds a custom field (Story 3)

1. As HR/L&D Admin: Settings > Forms > select **Training Needs Analysis**.
2. Add a field, e.g. label "Function", type `text`, not required.
3. Confirm it appears in the field list, ordered after the four system fields (Title, Priority,
   Department, Status) per `data-model.md`'s seeded `display_order`.
4. **Expected**: Save succeeds; the field is scoped to this tenant only (contracts: reuses
   `POST /tenant/form-fields`, unchanged from Spec 010).

## Scenario 2 — Manager creates, saves as Draft, then submits (Story 1)

1. As Manager: navigate to Learning > Training Needs Analysis (`/learning/tna`).
2. Click "New Training Need". Confirm the department field shows the Manager's own department and is
   not editable.
3. Fill in Title and Priority; leave the "Function" custom field from Scenario 1 blank; click Save
   (not Submit).
4. **Expected**: Entry appears in the Manager's own list with status "Draft"; reopening it shows the
   same partial data (contracts: `POST /tenant/training-needs` with `status: "draft"` implicit).
5. Reopen the Draft, fill in "Function", click Submit.
6. **Expected**: Status becomes "Submitted"; `submitted_at` is set (contracts: `PATCH .../:id` with
   `status: "submitted"`, required-field validation passes now that "Function" is filled).

## Scenario 3 — HR/L&D Admin sees only Submitted entries, org-wide (Story 2, Clarification Q3)

1. As HR/L&D Admin: open `/learning/tna`.
2. **Expected**: The Submitted entry from Scenario 2 is visible, labeled with its department.
3. As Manager: create a second entry and leave it as Draft (don't submit).
4. As HR/L&D Admin: refresh `/learning/tna`.
5. **Expected**: The new Draft entry does **not** appear in the HR/L&D Admin's list (research.md §2) —
   only the earlier Submitted one does.
6. Apply the department filter and the priority filter; confirm the list narrows correctly (contracts:
   `GET /tenant/training-needs?department=...&priority=...`).

## Scenario 4 — Cross-department isolation and delete rules (spec Edge Cases, Clarification Q1)

1. As a second Manager (or the same Manager account temporarily reassigned to the other seeded
   department) with only `tna.view.department`/`tna.manage.department`: attempt to open the first
   Manager's Submitted entry directly by ID.
2. **Expected**: `404` (contracts §"GET .../:id", research.md §9) — not visible, not editable.
3. As the original Manager: attempt to delete the now-Submitted entry from Scenario 2.
4. **Expected**: Blocked (`403`) — Submitted entries can only be deleted by a `tna.manage.all` holder
   (contracts §"DELETE .../:id").
5. As the original Manager: delete the still-Draft entry from Scenario 3 step 3.
6. **Expected**: Succeeds (`204`) — Managers may delete their own Drafts.
7. As HR/L&D Admin: delete the Submitted entry from Scenario 2.
8. **Expected**: Succeeds — `tna.manage.all` may delete any entry regardless of status.

## Scenario 5 — Nav and permission gating

1. As a user holding none of the four `tna.*` permissions: confirm the "Learning" sidebar section does
   not render at all, and a direct request to `/learning/tna` (or its underlying API routes) is
   rejected (contracts: `requireAnyPermission` on every route).
