# Quickstart: Validating the Roles Management UI

Prerequisites: `apps/api` and `apps/web` running (`pnpm dev` in each), local Postgres up, migrations
applied, and a tenant admin account holding `manage_roles` (every tenant's `hr_admin`-derived role
already has it — verified directly, research.md §1 — no manual grant needed).

## 1. Confirm the new endpoints and guard landed correctly

```bash
curl -s "http://localhost:3001/tenant/roles?subdomain=<tenant>" -H "cookie: <session>" | jq
# Expected: every tenant role, each with isSystem, memberCount, permissionKeys

curl -s "http://localhost:3001/tenant/permission-catalog?subdomain=<tenant>" -H "cookie: <session>" | jq
# Expected: flat list of { key, displayName, description, category }

# Attempt to PATCH a system role directly (bypassing the UI entirely)
curl -s -X PATCH "http://localhost:3001/tenant/roles/<hr_admin_role_id>?subdomain=<tenant>" \
  -H "cookie: <session>" -H "content-type: application/json" \
  -d '{"name":"Hijacked"}'
# Expected: 403 { "success": false, "message": "System roles cannot be modified." }
```

## 2. See every role at a glance (User Story 1)

1. Log in as a `manage_roles`-holding admin, open Administration > Roles.
2. Confirm the four default roles (`hr_admin`, `manager`, `employee`, and any others) appear with a
   "System" badge, disabled Edit/Delete with a "System roles cannot be modified" tooltip, and an
   accurate member count.
3. Confirm any pre-existing custom roles appear alongside them with active Edit/Delete controls.

## 3. Create a custom role (User Story 2)

1. Click "Create role," name it "Content Reviewer," leave description blank.
2. Confirm the permission checklist is grouped by category (`roles`, `platform`, `department`,
   `forms`, etc.) exactly matching whatever `GET /tenant/permission-catalog` returns — not a hardcoded
   list in the screen itself.
3. Check only `edit_content_library`, save. Confirm it appears in the list as Custom, member count 0,
   with exactly that one permission.
4. Attempt to create a second role also named "Content Reviewer" — expect a clear inline rejection
   sourced from the server's own `409`, not a frontend-only guess.
5. Expand/collapse a group with multiple permissions; click "select all" on one group and confirm only
   that group's items become checked.

## 4. Edit a custom role — with and without the impact warning (User Story 3)

1. Edit "Content Reviewer" (0 members) — change its permission set and save. Confirm it saves
   immediately, no dialog.
2. Assign a real member to "Content Reviewer" via the existing Members/invite flow.
3. Edit "Content Reviewer" again and click save — confirm a dialog appears stating the exact member
   count and that changes take effect immediately, with explicit Confirm/Cancel.
4. Click Cancel — confirm nothing was saved. Repeat and click Confirm — confirm the change is applied.

## 5. Delete a custom role, blocked or not (User Story 4)

1. Attempt to delete "Content Reviewer" while it still has the member assigned in step 4.2 — expect a
   blocking message with the exact member count and a link toward the Members list.
2. Reassign that member away from "Content Reviewer" (via the existing Members screen), then delete
   "Content Reviewer" again — expect immediate success, removed from the list.
3. Confirm no delete action exists anywhere in the UI for a system role.

## 6. Sidebar cleanup (User Story 5)

1. Confirm "Roles" appears under Administration as a real, active link (not a disabled "Soon" tag).
2. Confirm no "Permission" entry exists anywhere in the sidebar.
3. Log in as a user who does *not* hold `manage_roles` — confirm neither "Roles" nor "Permission"
   appears, and a direct navigation to the Roles URL is rejected (403).

## Verifying no functional regression

Re-run Spec 001's own existing integration tests for `POST`/`PATCH`/`DELETE /tenant/roles/:roleId`
(unrelated to system roles) — confirm they still pass unchanged, since this spec only adds a guard for
`sourceTemplateId IS NOT NULL` rows and two new read endpoints, touching no existing custom-role
behavior.
