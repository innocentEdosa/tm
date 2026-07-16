# Phase 0 Research: Training Request Rename

No Technical Context items were marked `NEEDS CLARIFICATION` (see plan.md) — this repo, stack, and
testing setup are already fixed by prior features. The decisions below resolve the
implementation-level naming/mechanism choices the spec deliberately left to planning (spec.md
Assumptions: "exact identifier strings ... appropriate for `/speckit-plan`").

## 1. New permission key string format

**Decision**: `training_request.view.all`, `training_request.view.department`,
`training_request.manage.all`, `training_request.manage.department`, `training_request.approve` —
snake_case compound first segment, dot-separated action/scope, one-to-one with the five existing
`tna.*` keys.

**Rationale**: Every existing dot-scoped permission key in this codebase (`team.view.all`,
`department.manage`, `roles.read`, `forms.manage.tenant`) uses a single-word first segment; `tna`
was one such single word. "Training Request" is the first two-word domain to need this pattern, and
this codebase already snake_cases compound identifiers elsewhere (`manage_team_members`,
`manage_authentication_settings`), so `training_request` is the smallest deviation from established
convention. The five keys are found in `apps/api/src/training-needs/tenant-training-needs-routes.ts`
(~15 literal occurrences) and `apps/api/src/db/schema/permissions.ts`-seeded rows.

**Alternatives considered**:
- `training-request.*` (hyphenated) — rejected, no existing key uses a hyphen inside a segment.
- `trainingRequest.*` (camelCase) — rejected, no existing key uses camelCase.
- Collapsing to a shorter single word (e.g. `request.*`) — rejected, too generic; would collide in
  intent with any future non-training "request" concept and loses the searchability of grepping
  for "training_request".

## 2. Frontend route segment

**Decision**: `apps/web/app/(dashboard-shell)/learning/training-requests/` (plural), mirroring the
directory Feature 014 created at `learning/tna/`, with the same nested `new/` and `[id]/` (plus
`[id]/edit/`) structure preserved.

**Rationale**: Plural matches the sibling nav-adjacent collection routes in this app
(`/settings/team` → "Members", `/settings/roles` → "Roles") and matches the plural nav label
decision below (§3). The dynamic segment name (`trainingNeedId` param) is left unchanged — it is an
internal identifier, not user-facing, and renaming it has no user-visible effect.

**Alternatives considered**: Singular `training-request/` — rejected only for consistency with the
plural convention above; either would have worked functionally.

## 3. Nav label and copy: singular vs. plural

**Decision**: Top-level nav entry reads "Training Requests" (plural) under the existing "Learning"
parent, replacing "Training Needs Analysis". Page-level copy uses "Training Request" (singular) when
referring to one entry (e.g. a single form/detail view: "New Training Request", "Training Request
Details") and "Training Requests" (plural) for list/collection contexts (nav label, list page title,
breadcrumb), per spec FR-001's own singular/plural split.

**Rationale**: Matches how "Training Needs Analysis" was a single top-level section name for what is
functionally a list of many entries — "Training Requests" reads the same way "Members" or "Roles"
already does for other list-backed nav entries in this app.

## 4. Old-route redirect mechanism

**Decision**: A single `redirects()` entry in `apps/web/next.config.ts`:
`{ source: '/learning/tna/:path*', destination: '/learning/training-requests/:path*', permanent: false }`.

**Rationale**: Next.js's built-in config-level redirects (no new package, Principle XII) handle the
full family of old paths (list, `new`, `[id]`, `[id]/edit`) in one rule via the `:path*` wildcard,
satisfying FR-006 without leaving stub page files at the old location. `permanent: false` (a 307) is
used rather than a permanent 308 — this is an internal renamed dashboard route, not a
publicly-indexed page, so there's no SEO reason to force permanent caching, and a temporary redirect
is trivially reversible if the path needs to change again.

**Alternatives considered**: A `page.tsx` left behind at the old path calling `redirect()` from
`next/navigation` per route — rejected, more files to maintain for the same outcome the config
handles in one rule.

## 5. Permission-migration mechanism and deployment ordering

**Decision**: One new Drizzle migration (`apps/api/drizzle/0057_rename_tna_permissions_to_training_request.sql`)
containing five `UPDATE permissions SET key = '<new>' WHERE key = '<old>'` statements — no
`DELETE`/`INSERT`, no changes to `role_permissions` or `role_template_permissions`. Deployed in the
same release as the code change that checks for the new key strings (both are part of this one
feature's rollout — no separate expand/contract migration phase is needed since the rename is
atomic and reversible by re-running the inverse `UPDATE` if ever needed).

**Rationale**: Confirmed via `apps/api/src/db/schema/roles.ts` (`role_permissions.permission_id` →
`permissions.id`) and `permissions.ts` (`id` is the stable UUID primary key; `key` is a separate
unique `text` column) that no table references the `key` string as a foreign key — every grant
points at the row's `id`, so relabeling `key` cannot orphan or duplicate a grant. This mirrors the
existing seed migrations' own pattern (`0050_seed_tna_permissions.sql`, `0052_seed_tna_approve_permission.sql`)
of using `key` purely as a human-readable lookup, never as a relational identity.

**Alternatives considered**: Insert five new permission rows and migrate `role_permissions`/
`role_template_permissions` rows to point at the new IDs, then delete the old rows — rejected,
strictly more moving parts for the same result, and the exact "orphan existing grants" failure mode
spec FR-005 explicitly rules out if any step is missed (e.g. forgetting `role_template_permissions`
alongside `role_permissions`).

## 6. Test file scope

**Decision**: Update permission-key literals inside the six existing integration test files listed
in plan.md's Testing section to the new `training_request.*` keys. Do not rename the test files
themselves in this feature (e.g. `training-needs-permission-gating.test.ts` keeps its name) — file
naming is bundled with the same "internal identifiers, deferred" boundary the spec draws around the
backend module directory and DB table name. Add one new test file,
`training-request-permission-migration.test.ts`, specifically asserting the migration's
grant-preservation property (FR-005/SC-002).

**Rationale**: The test *assertions* must change because the underlying permission keys they check
literally no longer exist after the migration — this is a correctness requirement, not a scope
choice. The test *file names* are internal and not required by any FR; leaving them as-is avoids
scope creep into the deferred internal-renames decision while still shipping correct, passing
tests.
