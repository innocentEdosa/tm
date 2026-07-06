# Research: Department Management

All Technical Context items were resolvable from the existing codebase (`apps/api`, `apps/web`,
`packages/ui`), the ratified spec, and the constitution. No item required an open research spike;
each decision below states what was chosen, why, and — where planning surfaced a real discrepancy
against the spec's own assumptions — what that discrepancy was and how it's resolved.

## 1. Extend the existing `departments`/`department_templates` tables, not new ones

**Decision**: Add `parent_department_id` (nullable, self-referencing FK), `description` (nullable
text), and `status` (text + CHECK, default `'active'`) to the existing `departments` table (created
by Spec 002's tenant-provisioning feature). Leave `department_templates` (the platform-global default
catalog seeded at provisioning) and `seedDefaultDepartmentsForTenant` untouched.

**Rationale**: `departments` already exists, is already tenant-scoped with RLS forced
(`0010_rls_departments.sql`), and already has the exact `(tenant_id, name)` unique constraint this
spec's FR-004 requires. Spec 002's own migration comment explicitly notes it was built "flat,
non-hierarchical" at the time — this spec is precisely the follow-up that adds hierarchy, not a
reason to fork a second table. The new columns are all nullable/defaulted, so every already-seeded
department row (from `seedDefaultDepartmentsForTenant`) remains valid with zero backfill: existing
departments simply start as top-level (`parent_department_id = NULL`), Active, with no description.

**Alternatives considered**:
- A brand-new `department_hierarchy` join/closure table, leaving `departments` flat — rejected: adds a
  second source of truth to keep in sync on every write, for no benefit over a single self-referencing
  column at this scale (3 levels, tens of rows per tenant).
- Replacing `departments` entirely with a redesigned table — rejected: would require a data migration
  for every already-provisioned tenant's seeded departments, and breaks `seedDefaultDepartmentsForTenant`
  and `provision-tenant.ts`'s existing, working call site for no functional gain.

## 2. Real discrepancy found: the spec's "Members list" doesn't fully exist yet

**What was assumed**: spec.md's Assumptions state "The one such picker that already exists today — the
tenant dashboard's Members list... — is in scope to update." This was written expecting a working list
view with columns/filters, matching how the sidebar's "Members" nav item reads.

**What's actually there**: `apps/web/app/(dashboard-shell)/settings/team/team-settings-client.tsx` and
its backend route (`POST /tenant-auth/team`) are, by that route's own code comment, "deliberately
minimal" — a single create form (full name, email, a raw-text "Role ID" field) with no list, no
filter, no edit, and no department field of any kind. There is also no `department_id` column on
`users` at all yet.

**Decision**: 
1. Add a nullable `department_id` FK (`ON DELETE RESTRICT`, matching the existing
   `user_roles.role_id` FK convention) to `users` — this is required for FR-008/015/016's member
   counts and deletion-blocking to operate on real data at all.
2. Add exactly one optional field — a department picker, Active departments only (spec FR-010/User
   Story 4) — to the existing add-team-member form and its `POST /tenant-auth/team` route, so
   `department_id` has a real, working way to be set (otherwise every department's member count would
   be permanently zero and the entire deletion-safety feature would be untestable).
3. Do **not** build a member list, filter, or edit-member capability. The deletion-blocked message's
   "shortcut into the Members list" (FR-016) links to the existing `/settings/team` page as the best
   available destination today — which today shows no list to filter. This is flagged, not silently
   reworded: once the Team Directory spec ships an actual list, the same link becomes a true
   department-filtered deep-link with no change needed on this feature's side (it already computes
   and would pass the department id in the link).

**Rationale**: Per constitution Principle VIII, the tradeoff is flagged rather than silently picked.
Building a full Team Directory member list here would meaningfully expand this feature's scope into a
separate, larger, not-yet-built spec the user's own context explicitly named as coming later. Building
nothing at all would leave this spec's core safety mechanism (member-aware deletion blocking)
permanently untestable and effectively fake. The one-field addition is the smallest change that makes
the feature's own acceptance criteria (SC-004, SC-005) verifiable against real data.

**Alternatives considered**:
- Ship the deletion-block message without a working member-count at all (always show "0 members," never
  block) — rejected: directly contradicts FR-008/SC-004, the feature's core safety guarantee.
- Build a minimal Team Directory list view as part of this spec so the shortcut link actually works —
  rejected: meaningfully larger scope than "Department Management," and duplicative of a spec the user
  has already indicated is coming separately.

## 3. Hierarchy invariants enforced via application-layer recursive query, not a DB trigger

**Decision**: Cycle-freedom, cross-tenant-parent rejection, and the 3-level depth cap are all checked
in TypeScript, inside the same `request.tenantDb`-scoped transaction as the write: a single
`WITH RECURSIVE` query walks the proposed parent's ancestor chain (through `request.tenantDb`, so RLS
already makes a cross-tenant id simply unreadable) and the route handler rejects the request if the
chain includes the department being saved (cycle) or is already 3 levels deep (depth cap), before the
`INSERT`/`UPDATE` runs.

**Rationale**: This codebase has zero existing Postgres trigger/function precedent (checked across
every migration in `apps/api/drizzle/`) — every structural invariant so far (the single-platform-role
partial unique index, the tenant `status` CHECK) is either a plain constraint or app-layer logic, never
a `plpgsql` trigger. Introducing triggers here would be a genuinely new mechanism for this one feature,
against Principle XII's "prefer built-in... reaching for [a new pattern] by default trades a one-time
convenience for a permanent liability." A recursive CTE is standard SQL, requires no new mechanism, and
runs inside the exact same transaction/RLS context every other write already uses.

**Alternatives considered**:
- A `plpgsql` `BEFORE INSERT OR UPDATE` trigger walking the parent chain in the database — rejected:
  would be the first trigger in this codebase, harder for the team to review/debug/test than a plain
  TypeScript query, for a check that only this one API's write paths ever need to run (no external
  writer exists that could bypass the app layer).
- A materialized-path or closure-table representation (storing each department's full ancestor path or
  a precomputed ancestor/descendant join table) — rejected: real value at deep hierarchies or heavy
  read/write ratios, but at a 3-level cap and tens of rows per tenant, a live recursive CTE per write
  and per list-read is simpler and has no dedicated-storage/consistency burden to maintain.

## 4. RLS: no new policy shape needed, cross-tenant parent rejected by construction

**Decision**: `departments`' existing RLS policy (`tenant_id = current_setting('app.tenant_id',
true)::uuid`, `0010_rls_departments.sql`) needs no change. The self-referencing
`parent_department_id` column is validated purely by *how* it's looked up: the application-layer
ancestor check (§3) and the parent-picker query both run through `request.tenantDb`, so a
cross-tenant department id simply returns zero rows — there is nothing to "reject," it is
unreachable, exactly like every other cross-tenant reference in this codebase (Spec 001's `roles`,
Spec 002's `departments` itself).

**Rationale**: Matches the existing `roles`/`departments`/`users` precedent exactly — RLS scopes row
*visibility*, and every write path only ever resolves references through that same tenant-scoped
lens, so cross-tenant references fail by simply not existing from the caller's point of view. No
additional `WITH CHECK` clause is needed beyond what's already forced on the table.

**Alternatives considered**:
- An explicit `parent_department_id`-specific RLS sub-policy or `CHECK` constraint joining back to
  `departments.tenant_id` — rejected: Postgres `CHECK` constraints cannot reference other rows/tables,
  and a trigger-based version was already rejected in §3 for the same "no new mechanism" reasoning.
  The existing RLS-scoped-lookup pattern already fully closes this gap.

## 5. Permission keys: `department.view` / `department.manage`, naming inconsistency accepted as flagged

**Decision**: Add exactly two rows to the existing `permissions` catalog table —
`department.view` and `department.manage` — seeded via a migration, following the identical seeding
pattern as `0014_seed_provision_tenant_permission.sql` / `0022_seed_tenant_auth_permissions.sql`.
`department.manage` is enforced as inherently including `department.view` (FR-013) by having every
manage-gated route also accept a manage-or-view check for its read parts, and by manage-holding roles
being expected to also carry `department.view` at the role-composition level (same "no auto-add"
behavior as every other permission, per Spec 001 FR-011 — an admin must explicitly add both keys to a
role; this spec does not silently grant one from the other in the catalog itself).

**Rationale**: The spec's own Assumptions already flag that `department.view`/`department.manage`
(dot-notation) differs from this codebase's shipped snake_case convention
(`manage_team_members`, `approve_enrollment`). `requirePermission()` does a plain string-equality
check against `permissions.key` (`apps/api/src/permissions/require-permission.ts`) — it has no
awareness of naming convention, so this works functionally regardless of style. This plan proceeds
with the spec's explicit naming rather than silently normalizing it to snake_case, per the spec's own
documented decision.

**Alternatives considered**:
- Silently renaming to `manage_departments`/`view_departments` to match existing style — rejected:
  the spec already made an explicit, considered decision on this naming and flagged the
  inconsistency for the team to reconcile later; a plan should not silently override a spec decision.

## 6. New `Modal` UI primitive in `packages/ui`

**Decision**: Add one small, reusable `Modal` component to `packages/ui/src` (dialog shell: overlay,
centered panel, close-on-overlay-click, Escape-to-close) for the Create/Edit Department form, styled
to the existing locked design system (Card's `.surface-card` treatment, `.btn`/`.field-input`
classes). No new npm dependency.

**Rationale**: `packages/ui` currently has no dialog/overlay primitive at all, and this feature is the
first to need one (Create/Edit Department is a small form, not worth its own full page route the way
the multi-step tenant-provisioning wizard is). Building it as a shared primitive — rather than
one-off markup inside `department-settings-client.tsx` — follows the exact precedent Spec 008 set for
Card/Badge/PageHeader: establish once, reuse everywhere, per constitution Principle V.

**Alternatives considered**:
- A dedicated full-page route (`/settings/department/new`, `/settings/department/:id/edit`) instead of
  a modal, avoiding any new component — rejected: heavier UX for a 4-field form than the reference
  image's (and the rest of this design system's) inline-panel pattern calls for, and would still need
  *some* new shared layout piece (a form-page shell) either way.
- A third-party dialog/headless-UI library — rejected outright without even proposing it for sign-off:
  a plain, small, styled `<div>` overlay fully covers this need (Principle XII); not worth a new
  dependency for one component.

## 7. Member count and deletion-block queries: single recursive CTE over the subtree

**Decision**: Both the list view's per-row *direct* member count (FR-015) and the deletion-block's
*subtree-rollup* member count (FR-016) are computed via one `WITH RECURSIVE` query per request — the
list query counts `users.department_id = departments.id` directly per row; the deletion-check query
first collects the department-plus-all-descendants id set (recursive CTE) and then counts
`users.department_id IN (that set)`. Both run through `request.tenantDb`.

**Rationale**: A single SQL round-trip per request avoids N+1 queries across a tree with 1-3 levels of
children, and reuses the exact ancestor/descendant traversal shape already needed for cycle/depth-cap
checks (§3) — same technique, applied in the opposite traversal direction (descendants instead of
ancestors).

**Alternatives considered**:
- Fetching the whole tree into application memory and counting/walking it in TypeScript — rejected:
  works fine at this scale too, but pushes a join Postgres already does efficiently into app code for
  no real benefit; the recursive-CTE approach is one query either way.

## 8. Testing: Vitest integration tests against real Postgres, mirroring existing suite

**Decision**: New backend behavior (cycle/depth-cap/cross-tenant-parent rejection, deletion blocking,
archive-as-alternative, permission gating) is covered by new files under
`apps/api/tests/integration/`, run via the existing `vitest run` script against a real Postgres
connection — same pattern as `rls-cross-tenant.test.ts` and `tenant-role-delete-blocked.test.ts`. No
new test framework or mocking library.

**Rationale**: This is the codebase's only existing testing convention; every RLS/permission-gated
behavior already ships this way. Mocked-database tests cannot prove RLS or a recursive-CTE cycle check
actually blocks anything — only a real Postgres connection can.

**Alternatives considered**: None seriously — this is a straightforward continuation of an existing,
working convention, not a new decision point.

## 9. Manager / Assistant Manager: two nullable FKs to `users`, `ON DELETE SET NULL`

**Decision**: Add `manager_id` and `assistant_manager_id` (both nullable `uuid`, FK → `users.id`,
`onDelete: "set null"`) directly to `departments`. Each may reference *any* user in the tenant
(Clarifications, 2026-07-06) — not restricted to users whose own `department_id` equals this
department. Application-layer validation rejects a write where `manager_id = assistant_manager_id`
(both non-null and equal) with a `422`.

**Rationale**: `SET NULL` (not `RESTRICT`, unlike `users.department_id` → `departments.id` in §2/data-
model.md) because a manager assignment is a soft, informational reference, not the org-structure
membership relationship the deletion-blocking rule (FR-008) cares about — spec FR-021 explicitly says
this assignment must never affect deletion behavior. If the referenced user is later removed from the
tenant (no such capability exists yet in this codebase, but the constraint should be correct
regardless), the department should simply lose that reference, not block the user's removal or the
department's own deletion.

**A note on the resulting circular schema reference**: `apps/api/src/db/schema/users.ts` already
gains `department_id` (→ `departments.id`) in §2; this decision adds `departments.ts` →
`users.id`, making the two schema files mutually referencing. This is safe under Drizzle's existing
`.references(() => otherTable.column)` pattern — already used elsewhere in this codebase (e.g.
`departments.source_template_id` → `department_templates.id`) — because the reference is a *lazy*
callback, not a direct import-time value; it is only invoked when `drizzle-kit generate` introspects
the schema, by which point both modules have finished loading. No restructuring (e.g. a third
join table) is needed solely to avoid the circularity. Task-level: verify `db:generate` produces the
expected two-column migration with no import-order error before proceeding (tasks.md).

**Alternatives considered**:
- `ON DELETE RESTRICT` (matching `users.department_id`'s convention) — rejected: would make removing a
  user block on them still being *someone's* manager somewhere, an accidental and confusing coupling
  the spec explicitly disclaims (FR-021).
- A separate `department_managers` join table (allowing multiple managers, or a role-tagged list) —
  rejected: the spec is explicit about exactly one Manager and one Assistant Manager per department,
  not an open-ended list; two plain nullable columns are the simplest structure matching that.

## 10. Minimal tenant-user-search endpoint for the Manager/Assistant Manager pickers

**Decision**: Add `GET /tenant/users?search=` (new route, `department.manage` gated, returns
`{ id, fullName, email }[]` matching `fullName`/`email` case-insensitively) — the smallest capability
that lets the Manager/Assistant Manager pickers search "any tenant user" (Clarifications). Lives
alongside the department routes (`apps/api/src/departments/`) since it exists to serve them, not as a
general-purpose user directory endpoint.

**Rationale**: No endpoint lists or searches tenant users at all today — `POST /tenant-auth/team` only
*creates* one. Building the picker without *some* server-side search is not possible once the scope is
"any tenant user" rather than "members of this department" (which would have been servable from the
department list's own data). Scoping this narrowly (id/name/email only, no roles/status/other detail,
gated by `department.manage` specifically rather than a new broader permission) keeps it from growing
into the out-of-scope Team Directory feature — same boundary already drawn in Assumptions for the
Members-list dependency.

**Alternatives considered**:
- Reuse/expose a fuller "list all users" endpoint if the Team Directory spec's own planning already
  defines one — not applicable: that spec doesn't exist yet, so there's nothing to reuse.
- Require typing an exact email instead of searching — rejected: meaningfully worse UX for a named
  picker, and the search query itself is trivial (`ILIKE`) at this codebase's stated scale (tens to
  hundreds of users per tenant, Technical Context).
- Gate the new endpoint behind a new, separate permission — rejected: it exists solely to serve the
  department Manager/Assistant Manager picker, which is already `department.manage`-gated; a second
  permission for the same actual capability would be redundant ceremony.
