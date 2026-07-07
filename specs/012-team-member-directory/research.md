# Research: Team Member Directory (List View)

All items below were resolved by reading the actual current codebase (`apps/api/src/tenant-auth/
tenant-team-routes.ts`, `apps/api/src/db/schema/users.ts`, `apps/api/src/departments/
department-hierarchy.ts`, `apps/api/src/custom-fields/*`, `apps/api/src/types/fastify.d.ts`,
`apps/web/app/(dashboard-shell)/*`) — cross-checked twice, once directly and once via an
independent research pass, with identical conclusions both times. No item required speculation.

## 1. No list/GET route for team members exists today — confirmed, not assumed

**What was checked**: The spec's own dependency on "Team Member Invitations (Spec 6, implemented)"
could have meant a list endpoint already existed alongside invite-creation. A full read of
`tenant-team-routes.ts` (92 lines) and a repo-wide grep for any other route touching users/members
found exactly one route: `POST /tenant-auth/team` (create + invite), gated
`requireAnyPermission("manage_team_members", "team.create")`.

**Decision**: This spec adds a genuinely new `GET /tenant/team` route — not a permission change on
an existing one. It's added to the same `tenant-team-routes.ts` file (same resource family), not a
new route file, mirroring how Roles' and Department's own list + mutate routes coexist in one file
per resource.

**Alternatives considered**: A separate `tenant-team-list-routes.ts` file was considered for
symmetry with the route's different path prefix (`/tenant/team` vs. the existing route's
`/tenant-auth/team`), but rejected — splitting one resource's routes across two files for a path
prefix difference alone would be inconsistent with every other module in this codebase, where one
file owns one resource's full route set regardless of path segment naming history.

## 2. `users` schema has no invited-by, last-login, or status column — confirmed

**What was checked**: Full current column list of `users` (`id, tenantId, fullName, email,
passwordHash, mustChangePassword, otpExpiresAt, failedLoginCount, lockedUntil, departmentId
(nullable), createdAt, updatedAt`). No column answers "who invited this member" (spec FR-006's
metadata requirement); `createdAt` already answers "when." No column exists for an
Active/Invited/Suspended status enum, and no avatar/profile-image column.

**Decision**:
- **Invite date** → existing `createdAt`, no new column needed.
- **Invited by** → new nullable `users.invited_by` column (`uuid`, FK → `users.id`,
  `onDelete: "set null"`), populated by the existing `POST /tenant-auth/team` handler at creation
  time going forward. Existing rows get `NULL` — there is no way to know retroactively who invited
  an already-created member, the same "look-forward-only" precedent this codebase has already used
  for every prior spec's genuinely new column with no historical source of truth.
- **Account status** → derived, not stored: `mustChangePassword === true` → "Invited" (never
  completed onboarding); `mustChangePassword === false` → "Active." "Suspended" has no backing data
  anywhere in this schema today — displaying it is deferred entirely to whichever spec introduces
  the capability to suspend a member (already noted as out of scope in spec.md's own Assumptions).
- **Avatar** → no image column exists or is needed; reuses the same initial-letter avatar pattern
  already established in `AppShell`'s own identity display (`session.email.charAt(0).toUpperCase()`),
  applied here to the member's `fullName` instead, since Name is the primary display field in this
  list (not email).

**Alternatives considered**: Adding a full `status` enum column (Invited/Active/Suspended as one
stored value) was considered, but rejected for this spec — "Suspended" has no product mechanism yet
to ever become true, so storing a three-value enum today would mean shipping a state the system can
never actually reach until a future spec adds the missing suspend capability. Deriving the two
values that *do* have real meaning today from `mustChangePassword` avoids inventing unreachable state.

## 3. Department-subtree helper already exists — `collectSubtreeIds`, no new helper needed

**What was checked**: All five exports of `department-hierarchy.ts`. `collectSubtreeIds(tenantDb,
departmentId): Promise<string[]>` (used today for Department's own deletion-block member rollup)
already returns a department's own id plus every descendant, any depth, via one recursive CTE.

**Decision**: Both places this spec needs "a department and its descendants" — the
`team.view.department` visibility filter and the org-wide department filter dropdown's
parent-includes-children behavior — call this exact existing function. No new hierarchy query is
written.

**Alternatives considered**: None — this is a direct, exact-fit reuse of infrastructure already
proven correct and tested by Department Management (spec 009).

## 4. The Custom Fields Framework is fully generic — "member" needs one seed row, zero framework changes

**What was checked**: `custom_field_values.entityId` has no DB-level foreign key at all — it's
polymorphic by design, unique only on `(tenantId, entityId, fieldId)`. `getFormFields(tenantDb,
formKey)` takes a plain string `formKey` with zero Department-specific branching.
`GET /tenant/custom-field-values?formKey=&entityId=` already exists, generically, gated only by
`requireTenantUserSession()` (no extra permission — same reasoning as `GET /tenant/form-fields`,
research.md §4 of spec 010).

**Decision**: This spec adds exactly one new `form_definitions` row (`key: 'member'`), mirroring
`0030_seed_department_form_definition.sql`. The expanded row's custom-field rendering calls the
existing generic `getFormFields`/`GET /tenant/custom-field-values` exactly as Department's own detail
view already does — no new framework code.

**Alternatives considered**: None — the framework was explicitly built (spec 010) to make this kind
of second-consumer addition a seed-row-only change; building anything new here would duplicate
already-generic infrastructure.

## 5. No pagination pattern exists anywhere in this codebase yet

**What was checked**: Grepped `apps/api/src` for `.limit(`, `.offset(`, `pageSize` — zero
non-test hits. Department's and Roles' own list endpoints both currently return every row
unpaginated.

**Decision**: This is the first paginated list endpoint in the codebase. Plain Drizzle
`.limit()`/`.offset()` (backed by a `count(*)` query for the total) is used — no new dependency,
consistent with Constitution Principles XII–XIII. A new small reusable pagination UI primitive is
added to `packages/ui/src` (`pagination.tsx`) since none exists; it follows this package's existing
visual language (same spacing/typography tokens as `Card`/`Badge`/`PageHeader`), not a new style.

**Alternatives considered**: Cursor-based pagination was considered (avoids the "page N shifts if
rows are added/removed mid-browse" class of bug) but rejected for this pass — offset pagination
matches the spec's own explicit "X–Y of Z with prev/next" UI requirement most directly, and this
codebase's typical tenant member-list sizes (dozens to low hundreds) don't yet justify cursor
pagination's added complexity. Revisit if a tenant's real member count grows large enough for
page-drift to become a practical problem.

## 6. `request.user` does not carry `departmentId` — must be resolved per-request

**What was checked**: `apps/api/src/types/fastify.d.ts`'s `FastifyRequest.user` decoration carries
only `{ id, tenantId }`. No existing request-scoped value already holds the caller's own department.

**Decision**: The new route handler (via the new `team-visibility.ts` helper) issues one extra
`SELECT department_id FROM users WHERE id = request.user.id` when the caller holds
`team.view.department` and not `team.view.all`, then calls `collectSubtreeIds` on the result (or
returns the "no department assigned" empty state per spec's own edge case if that value is `NULL`).

**Alternatives considered**: Decorating `request.user` with `departmentId` at session-resolution
time (once, for every request) was considered, since it would save this one extra query on every
call to this specific route. Rejected for this pass — that decoration point
(`tenant-user-context.ts`) is shared by every tenant route in the system, and widening a
widely-shared decoration for the benefit of one new route is a larger, riskier change than one
extra indexed lookup on `users.id` (the primary key) confined to this route's own handler.

## 7. Frontend conventions confirmed for reuse

**What was checked**: Both `roles-settings-client.tsx` and `department-settings-client.tsx` use
`const API_BASE = "/tenant-api/tenant";` with a `?subdomain=` query param on every request (the
same-origin rewrite proxy established for the Super Admin cookie cross-origin gap, per this
project's own memory of that incident). No pagination component exists in `packages/ui/src` today.

**Decision**: The new list fetch uses the same `API_BASE`/`?subdomain=` convention, calling
`GET ${API_BASE}/team?subdomain=...&search=...&departmentId=...&page=...`. `packages/ui/src/
pagination.tsx` is a new, small, controlled component (`page`, `pageSize`, `total`, `onPageChange`)
reusable by any future paginated list.

**Alternatives considered**: None — this is a direct continuation of an already-established,
working convention; no reason to deviate for this one screen.
