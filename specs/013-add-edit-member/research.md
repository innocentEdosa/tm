# Research: Add/Edit Team Member

All items below were resolved by reading the actual current codebase (`apps/api/src/tenant-auth/
tenant-team-routes.ts`, `apps/api/src/db/schema/roles.ts`, `apps/api/src/departments/
tenant-department-routes.ts`, `apps/api/src/custom-fields/save-values.ts`, `apps/web/app/
(dashboard-shell)/settings/team/team-settings-client.tsx`, `apps/web/app/(dashboard-shell)/settings/
department/department-settings-client.tsx`) — no item required speculation.

## 1. The "Role ID issue" is confirmed as a real, live bug — not just a UX nicety

**What was checked**: The current `POST /tenant-auth/team` handler inserts directly into
`user_roles` with the client-supplied `roleId`, with zero existence check beforehand:
`await request.tenantDb.insert(userRoles).values({ tenantId, userId: createdUser.id, roleId })`.
`user_roles.role_id` has a foreign key to `roles.id` — an invalid `roleId` currently throws an
uncaught `DrizzleQueryError` (FK violation), which this codebase's own error-handling convention
would surface as an unhandled `500`, not a clean validation error. Worse, this happens *after* the
`users` row has already been inserted and committed (per `tenant-context.ts`'s known "commits on
`onResponse` regardless of status code" behavior, already documented from a prior spec's own
atomicity fix) — meaning a bad role id today can leave an orphaned `users` row with no role at all.

**Decision**: The new `POST` and `PATCH` handlers both validate the role id (and department id)
*before* any write, mirroring Department's own established "validate everything first" pattern
(`validateHierarchyAndManagers` + `validateCustomFieldValues`, both called before the `insert`/
`update`). This closes both the 500-instead-of-422 bug and the orphaned-row atomicity gap in the
same pass.

**Alternatives considered**: Wrapping the existing insert-then-role-assign sequence in a try/catch
that deletes the just-created user on a role FK failure was considered, but rejected — validating
first is strictly simpler and matches this codebase's own already-established convention, rather
than adding compensating-transaction logic for a case that's fully preventable by checking first.

## 2. Role reassignment is a single `UPDATE`, not delete+insert

**What was checked**: `user_roles` has `id`, `tenantId`, `userId`, `roleId`, `createdAt`, with a
unique constraint on `(userId, roleId)` — not on `userId` alone. The "exactly one role per user"
rule (referenced throughout this codebase, e.g. spec 011's own Assumptions) is an
application-level invariant, not a DB constraint.

**Decision**: Editing a member's role is `UPDATE user_roles SET role_id = $newRoleId WHERE user_id =
$userId` — a single-row update, assuming exactly one existing row per user (true under the
established invariant). This is simpler than delete+insert and preserves the invariant by
construction (the one row just points at a different role).

**Alternatives considered**: Delete-then-insert was considered (would also technically work) but
rejected as unnecessary complexity for no additional safety — the invariant is already guaranteed by
every other part of this codebase never creating a second row.

## 3. Reusable data sources for the two new dropdowns — no new list endpoints needed

**What was checked**: `GET /tenant/roles` (spec 011) already returns `{id, name, description,
permissionKeys, isSystem, memberCount}` for every role in the tenant, gated by
`requireAnyPermission("manage_roles", "roles.read")`. `GET /tenant/departments` (spec 009) already
returns flat rows including `id`, `name`, `status`, `parentDepartmentId`, gated by
`requirePermission("department.view")` — it does **not** precompute a hierarchy path string; the
existing Department screen itself builds ancestor chains client-side (walking `parentDepartmentId`
against the already-fetched flat list, e.g. its own search-with-ancestors logic).

**Decision**: Both dropdowns reuse these two existing endpoints exactly as-is — no new backend list
route. The Department dropdown's "Engineering > Backend" path is computed client-side from the
already-fetched flat list, the same technique Department's own screen already uses for a related
purpose (nothing new is invented, just reused for a new UI element).

**Alternatives considered**: Adding a path string to `GET /tenant/departments`'s own response was
considered, but rejected — it would change a response shape three other consumers already depend on,
for a need only this one new dropdown has; computing it client-side from data already being fetched
is simpler and has zero blast radius on existing consumers.

## 4. Cross-permission dependency for populating the dropdowns is pre-existing, not new

**What was checked**: `GET /tenant/roles` requires `manage_roles`/`roles.read`; `GET /tenant/
departments` requires `department.view`. The *current* Add Member form already depends on
`department.view` for its own Department picker — this is not a new coupling this spec introduces.

**Decision**: Documented as an Assumption (spec.md), not solved here. HR/L&D Admin already holds
every one of these permissions today, so this is not a practical blocker; widening it (e.g. having
the team routes expose their own scoped read of roles/departments) would be solving a problem no
real tenant has today, for a hypothetical custom role that doesn't yet exist.

**Alternatives considered**: None — carrying forward an existing, already-accepted coupling rather
than inventing a new one.

## 5. Custom Fields Framework reuse — third real consumer, zero framework changes

**What was checked**: `validateCustomFieldValues`/`writeCustomFieldValues`/`saveCustomFieldValues`
(`apps/api/src/custom-fields/save-values.ts`) are fully generic — they take a `formKey` string and a
merged `MergedFieldRow[]` (from `getFormFields`), with no Department-specific logic anywhere.
Department's own `renderCustomField`/`renderFormField` dispatcher (`department-settings-client.tsx`)
already renders every `field_type` (`text`/`textarea`/`number`/`date`/`select`/`multiselect`) with
per-type inputs and inline field-level error display.

**Decision**: The team member create/edit form calls the exact same three save-values functions
(`getFormFields(tenantDb, "member")`, `validateCustomFieldValues`, `writeCustomFieldValues`) and
mirrors Department's own `renderCustomField` dispatcher verbatim, adapted only in field-key naming
(`custom-${field.fieldKey}` stays identical). The Team Member Directory's existing `member` form
definition (seeded in spec 012) and its existing read-only `MemberCustomField` interface (currently
only `{id, fieldKey, label}`) needs widening to the full field shape (`fieldType`, `isRequired`,
`options`, `displayOrder`) the create/edit form needs to render and validate correctly — the
read-only profile view never needed those extra properties, but the form does.

**Alternatives considered**: None — this is a direct, exact-fit reuse of infrastructure explicitly
built (spec 010) to make a second/third consumer this cheap.

## 6. Form/permission wiring — additive `team.edit`, no route registration changes

**What was checked**: `tenant-team-routes.ts` is already registered once in `server.ts`; adding a new
`fastify.patch(...)` call to the same file needs no new registration. The existing granular
permission migrations (`0038`, `0040`) establish the exact seed/grant/backfill SQL shape to mirror
for `team.edit`.

**Decision**: One new migration, `0042_seed_team_edit_permission.sql`, granting `team.edit`
(category `settings`) to the HR/L&D Admin template only (org-wide, per the Clarifications answer —
no Manager grant, since Manager holds no team-management permission of any kind today).

**Alternatives considered**: None — direct continuation of an already-established, working
convention.

## 7. `GET /tenant/team`/`PATCH` needed widening to include raw `roleId`/`departmentId` (found during implementation)

**What was found**: Spec 012's `GET /tenant/team` response (and this spec's own `PATCH` response,
which deliberately mirrors it) only included `roleName`/`departmentName` — display strings, not the
underlying ids. Pre-filling the edit form correctly requires the actual `roleId`/`departmentId`, not
a name-based lookup — role names are unique per tenant (safe to match), but department names are
**not** guaranteed unique across different parents in a hierarchy (e.g. two different top-level
departments could each have a child named "Backend"), so matching by name alone would have been a
real, silent correctness bug for any tenant with same-named departments under different parents.

**Decision**: Widened both `GET /tenant/team` and `PATCH /tenant/team/:userId`'s response to include
`roleId`/`departmentId` directly (the query already joined `roles`/`departments` for their names, so
this is a zero-cost addition, not a new join). Existing tests asserting on `roleName`/`departmentName`
via `toMatchObject` are unaffected by the additional fields.

**Alternatives considered**: Resolving the edit form's pre-fill by matching the currently-displayed
`roleName`/`departmentName` back to an option in the already-fetched dropdown lists was considered,
but rejected as the exact class of bug described above — this is a data-correctness issue, not a
convenience tradeoff, so it was fixed at the response-shape level instead.
