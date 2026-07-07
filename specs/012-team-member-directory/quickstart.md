# Quickstart: Team Member Directory (List View)

Validation scenarios matching spec.md's user stories. All API calls below assume a tenant session
cookie already established (see any prior spec's own quickstart for the login flow) and use the
contract in `contracts/team-directory-api.md`.

## Prerequisites

- A tenant with at least one department hierarchy two levels deep (parent + child), and members
  assigned across the parent, the child, and an unrelated third department.
- Two custom fields configured for `formKey: "member"` (via the existing Settings > Forms screen,
  once the `member` form_definition seed row exists).
- One user holding `team.view.all` (e.g. the tenant's HR/L&D Admin), one holding only
  `team.view.department` (e.g. a Manager scoped to the parent department above), and one holding
  neither.

## Scenario 1 — Org-wide directory (User Story 1)

1. Log in as the `team.view.all` user, open Members.
2. Confirm every member across all three departments appears.
3. Search by a substring of one member's name; confirm the list narrows to matching members only,
   still spanning every department.
4. Confirm the description line reads "View and manage everyone in your organization."

**Expected**: `GET /tenant/team` returns every member with no department restriction; search applies
server-side.

## Scenario 2 — Department-scoped directory and its security boundary (User Story 2)

1. Log in as the `team.view.department` manager (scoped to the parent department).
2. Open Members; confirm only members of the parent and its child department appear — the
   unrelated third department's members do not.
3. Confirm the description line reads "View and manage members of your department."
4. Attempt a direct API call: `GET /tenant/team?departmentId=<unrelated-department-id>` using this
   manager's session cookie.

**Expected** (step 4): the response still contains only the parent+child subtree's members — the
`departmentId` query param is silently ignored for a `team.view.department`-only caller, never
honored to expand or redirect their scope. This is the spec's core security guarantee (FR-003,
SC-002, SC-004) — verify via the raw response body, not just the UI.

## Scenario 3 — Hierarchy-aware department filter (User Story 3)

1. Log in as the `team.view.all` user, open the department filter dropdown.
2. Confirm every department in the tenant appears as an option.
3. Select the parent department.
4. Confirm members from the parent and its child appear, and the unrelated department's members do
   not.
5. Log in as the `team.view.department` manager again; confirm no department filter control is
   rendered at all.

## Scenario 4 — Expandable row detail (User Story 4)

1. As either viewer, click a row for a member who has values set for one of the two configured
   custom fields but not the other.
2. Confirm both fields render with their tenant-configured labels — the set one shows its value, the
   unset one shows the same muted, descriptive empty-state treatment already established for
   Department's own detail view (not "—").
3. Confirm "invited by" and "invite date" render (or, for a member created before this feature
   shipped, confirm "invited by" gracefully shows nothing rather than an error).
4. As a tenant with zero custom fields configured for `member`, click any row and confirm only the
   system metadata shows — no broken placeholders for a field set that doesn't exist.

## Scenario 5 — No-permission and empty states

1. Log in as the user holding neither permission; confirm "Members" does not appear in the nav at
   all, and a direct `GET /tenant/team` call returns `403`.
2. Temporarily unassign the `team.view.department` manager's own department (set to `NULL`); log in
   and confirm a distinct "you aren't assigned to a department yet" empty state, not a generic
   zero-results state or an error.
3. As the org-wide viewer, search for text matching no member; confirm a distinct "no members match"
   empty state, visually different from the no-permission and no-department-assigned states.

## Scenario 6 — Pagination

1. Seed enough members in one tenant to exceed one page (more than the default page size).
2. Confirm the "X–Y of Z" indicator reflects the viewer's own visibility-scoped total (an org-wide
   viewer sees the tenant-wide count; a department-scoped viewer sees their subtree's count only).
3. Click "next"; confirm the next page of results loads and the indicator updates. Click "previous"
   from page 1; confirm it's disabled/hidden. Navigate to the last page; confirm "next" is
   disabled/hidden there.

## Cleanup

Remove any test members, custom field configurations, and department reassignments created purely
for this validation pass, consistent with this project's established practice of not leaving test
data behind in a shared dev database.
