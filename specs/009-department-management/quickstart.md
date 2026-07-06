# Quickstart: Validating Department Management

Prerequisites: `apps/api` and `apps/web` running (`pnpm dev` in each), local Postgres up
(`docker compose up postgres`), migrations applied (this feature's migrations, plus every prior
one), and at least one seeded tenant with an admin account holding both `department.view` and
`department.manage` on their role (assign via the existing role-management UI/API, Spec 001 —
these two permissions are seeded into the catalog but not auto-added to any role).

## 1. Confirm the schema changes and new permissions landed correctly

```bash
psql "$DATABASE_URL" -c "\d departments"   # expect parent_department_id, description, status,
                                             # manager_id, assistant_manager_id columns
psql "$DATABASE_URL" -c "\d users"          # expect department_id column
psql "$DATABASE_URL" -c "SELECT key FROM permissions WHERE key LIKE 'department.%';"
# Expected: department.view, department.manage
```

## 2. View: hierarchy and search render correctly (User Story 1, spec FR-001/FR-014)

1. Log in as the admin, open the "Administration → Department" nav entry.
2. Create a top-level department "Org", then create "Division" under "Org", then "Team" under
   "Division" (see §3). Confirm the list shows all three nested correctly, with "—" as the parent for
   "Org".
3. Search "Team" — confirm "Team" appears with its ancestor chain ("Org" → "Division") still visible,
   not orphaned.
4. Log in as a user whose role holds neither permission — confirm the Department nav entry does not
   appear, and `curl` to `GET /tenant/departments` without the permission returns `403`.

## 3. Create/edit: hierarchy rules (User Story 2, spec FR-002–FR-007)

1. Create "Org" (no parent), "Division" (parent: Org), "Team" (parent: Division) — all succeed.
2. Attempt to create a 4th-level department under "Team" — expect the parent picker excludes "Team"
   as an option, and a direct API `POST` with `parentDepartmentId` = Team's id returns `422`
   ("Departments can only be nested up to 3 levels deep").
3. Attempt to edit "Org" to set its parent to "Team" (Org's own descendant) — expect the picker
   excludes it, and a direct API `PATCH` with that value returns `422` (cycle rejected).
4. Attempt to create a department named "org" (different case) — expect `409` (case-insensitive
   duplicate).
5. Using two seeded tenants, confirm a `PATCH` from tenant A referencing tenant B's department id as
   `parentDepartmentId` behaves as if that id doesn't exist (RLS-scoped lookup fails to resolve it) —
   confirms FR-005/FR-007 by construction, not just application logic.

## 4. Manager / Assistant Manager assignment (User Story 2, spec FR-019/FR-020/FR-021)

1. Edit "Team" and open the Manager picker — confirm it searches across *every* tenant user (type a
   few characters of any user's name, including one never assigned to "Team" itself), not just
   members already in "Team".
2. Assign a Manager and a different Assistant Manager to "Team" — confirm both save and display
   correctly in the list (or "—" if you skip one — both are optional).
3. Attempt to set the same person as both Manager and Assistant Manager on "Team" — expect a `422`
   ("Manager and Assistant Manager must be different people"), both via the UI and a direct API call.
4. With "Team" still having zero direct members and no children, delete it — expect success even
   though it has a Manager/Assistant Manager assigned (FR-021 — this assignment never blocks
   deletion). Recreate "Team" (parent: Division) before continuing to §5, since later steps assume it
   exists.

## 5. Members, counts, and deletion blocking (User Story 3, spec FR-008/FR-015/FR-016)

1. On the existing "Add team member" form (`/settings/team`), confirm a new "Department" field
   appears, listing only Active departments.
2. Add a member to "Team". Confirm the Department list's "Team" row now shows a direct member count of
   1, and "Division"'s own row still shows 0 (direct count, not a rollup — FR-015).
3. Attempt to delete "Division" (which has a member-having child, "Team", but no direct members of its
   own) — expect `409`, reason `has_members`, `memberCount: 1` (the subtree rollup, FR-016), with a
   `membersListHref` pointing at `/settings/team?department=<id>`.
4. Attempt to delete "Team" directly — same block, `memberCount: 1`.
5. Attempt to delete "Org" — expect `409`, reason `has_children` (it has "Division" beneath it),
   distinct from the member-count reason.
6. Archive "Team" instead (status → archived) — expect success even though it still has a member
   assigned, and even while blocked from deletion (FR-009).
7. Delete a freshly created, empty, childless department — expect success in one call (SC-005).

## 6. Active-only picker downstream (User Story 4, spec FR-010)

1. With "Team" now archived (step 5.6), open the "Add team member" form again — confirm "Team" no
   longer appears in the department picker.
2. Confirm the member added to "Team" in step 5.2 is unaffected — their assignment still stands, and
   (once such a view exists) would still display correctly in historical records; this feature makes
   no change that hides or breaks that existing assignment.

## 7. Permission gating end-to-end (spec FR-011/FR-012/FR-013)

1. Remove `department.manage` (keep `department.view`) from a test role — confirm that user can see
   the list but the "Add department" button and Edit/Delete/Archive actions are gone, and a direct
   `POST`/`PATCH`/`DELETE` API call returns `403`. Also confirm `GET /tenant/users?search=` returns
   `403` for this user (it's gated by `department.manage`, same as every write action).
2. Remove both permissions — confirm the nav entry disappears entirely and `GET /tenant/departments`
   returns `403`.

## Verifying no functional regression

Re-run the existing Tenant Provisioning Core quickstart's department-seeding scenario (Spec 002) —
confirm newly provisioned tenants still get their default flat department set, now with
`status = 'active'` and `parent_department_id = NULL` on every seeded row, with no errors from the new
columns/constraints.
