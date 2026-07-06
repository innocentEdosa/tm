# Research: Extensible Custom Fields Framework

All Technical Context items were resolvable from the existing codebase (`apps/api`, `apps/web`,
`packages/ui`), the ratified spec, and the constitution. No item required an open research spike;
each decision below states what was chosen, why, and — where planning surfaced a real gap against the
spec's own literal data model — what that gap was and how it's closed.

## 1. `form_fields`'s dual-visibility RLS policy: composing three existing patterns, no new mechanism

**Decision**: Three permissive policies on `form_fields` (Postgres OR's multiple permissive policies
together for the same command):

1. `tenant_isolation` (the standard shape every tenant table already uses): `USING (tenant_id =
   current_setting('app.tenant_id', true)::uuid) WITH CHECK (same)` — a tenant session can always
   read and write its own rows.
2. `global_fields_readable`, `FOR SELECT` only: `USING (tenant_id IS NULL)` — any tenant session can
   also *see* global rows. No `WITH CHECK`, so this policy grants no write capability at all.
3. `super_admin_full_access`: `USING (current_setting('app.is_super_admin', true) = 'true') WITH
   CHECK (same)` — full read/write for a Super Admin session, regardless of `tenant_id`.

Because policy 1's `WITH CHECK` requires `tenant_id = <the caller's own tenant>`, a tenant session can
never satisfy it with `tenant_id IS NULL` (that comparison is `NULL`, not `true`, in SQL's three-valued
logic) — so a tenant admin can create/edit/delete only its own rows, never a global one, satisfying
spec FR-004/User Story 3 at the database layer, not just in the UI.

**Rationale**: Every one of these three techniques already exists independently in this codebase:
- The plain `tenant_isolation` shape is used by every tenant-scoped table since Spec 001.
- The "additive, narrowly-scoped, `FOR SELECT`-only permissive policy" technique is exactly what
  `0018_rls_tenants_subdomain_lookup.sql` already did for a different narrow purpose (pre-auth
  subdomain lookup) — same Postgres mechanism, different flag.
- `app.is_super_admin` has been set on every Super-Admin-authenticated request's transaction since the
  Super Admin Authentication spec (`apps/api/src/platform-auth/super-admin-context.ts`) — that plugin's
  own doc comment already says this exists so "any query issued through it is subject to the Super
  Admin RLS allowance clause **future tenant-scoped tables adopt**." No table has actually adopted it
  yet (confirmed: no `CREATE POLICY` anywhere references `app.is_super_admin` today, only comments cite
  it as precedent). This spec is that adoption — completing a mechanism already wired, not inventing
  one.

This means Super Admin's future authoring UI (out of scope for this spec's build, per FR-002) needs no
further schema/RLS work when it's eventually built — it can write `tenant_id = NULL` rows through
`request.superAdminDb` today, the moment that route exists.

**Alternatives considered**:
- A `BYPASSRLS` database role for Super Admin — rejected outright: `drizzle/README.md` already
  documents this codebase's deliberate stance that nothing uses `BYPASSRLS`, enforcing "is this really
  Super Admin" entirely through the explicit-allowance-clause pattern instead. Introducing one now
  would contradict established, documented policy for no real benefit.
- Giving `form_fields` only the plain `tenant_isolation` policy and handling "also show global rows" in
  application code (fetch tenant rows and global rows as two separate queries, app-side) — rejected:
  works, but pushes a security-relevant guarantee (global fields are read-only) into every call site
  remembering to enforce it, instead of the database enforcing it once. The multi-policy composition
  keeps the guarantee in one place, consistent with Principle I's "not merely hoped for at the UI
  layer."

## 2. Real gap found: the specified unique constraint doesn't catch cross-scope key collisions

**What was assumed**: The feature request's own data model states "Unique constraint on `(tenant_id,
form_definition_id, field_key)` within `form_fields` to prevent duplicate field keys per tenant per
form" — read at face value, this sounds like it fully prevents any two fields on the same form sharing
a key.

**What's actually true**: Postgres unique indexes treat `NULL` as distinct from any other value
(including from other `NULL`s) — but that's not even the relevant mechanism here, because a *global*
row's `tenant_id` is `NULL` while a *tenant* row's `tenant_id` is a real UUID; the three-column tuple
`(NULL, form_definition_id, 'notes')` and `(tenant_uuid, form_definition_id, 'notes')` are simply two
different tuples regardless of NULL-handling — the literal constraint, exactly as specified, does
**not** stop a tenant from creating a field keyed `notes` even if a global `notes` field already exists
for that form. Rendering two same-keyed fields together would break spec FR-006's "no duplicates" and
directly contradict SC-003.

**Decision**: Keep the literal unique index exactly as specified (it's still correct and necessary for
same-scope collisions), and add an application-layer check — before any create (tenant or, later,
Super Admin) — that queries for an existing field with the same `field_key` for that
`form_definition_id` across *both* scopes (own tenant's rows and global rows), rejecting the write
before it happens if found. This runs inside the same transaction as the eventual insert, so there's no
TOCTOU gap within a single request.

**Rationale**: This is a real, easy-to-miss correctness gap between the request's literal data model
and its own stated acceptance criteria (FR-005/SC-003 both require the *cross-scope* guarantee); per
Constitution Principle VIII, the gap is flagged and closed explicitly rather than silently leaving the
weaker, literally-specified guarantee in place.

**Alternatives considered**:
- A partial/expression unique index using `coalesce(tenant_id, '00000000-...')` to force global rows
  into one comparable "slot" alongside each tenant's own slot — this only prevents *global-vs-global*
  or *tenant-vs-its-own* duplicates (which the literal index already does); it still can't express "no
  tenant row may match any global row's key" in a single index, because that requires comparing against
  a *different* row's `tenant_id` value, which a `CHECK`/unique constraint on a single row can't do at
  all. An application-layer (or trigger-based) check is unavoidable for this specific rule; the
  application layer was chosen over a trigger for the same reasoning Spec 009 already used (research.md
  §3 there — no existing trigger precedent in this codebase).

## 3. `form_definitions`: platform-global, seeded once, zero runtime write path

**Decision**: `form_definitions` gets the exact same treatment as `permissions`/`department_templates`
— no `tenant_id`, `SELECT`-only grant to the app's runtime role, `INSERT`/`UPDATE`/`DELETE` reserved for
the migration/owner role. One row is seeded: `key = 'department'`. No `tna` row is seeded — Training
Needs Analysis has no spec yet, and seeding a form type with no real consuming module would present a
form type in the tenant-facing list that does nothing, contradicting the spec's own framing of form
types as registered "when a module ships."

**Rationale**: Directly satisfies FR-001/FR-013/SC-006 ("no form type without a code change," "the
list always exactly matches what's developer-registered") using a pattern this codebase already has
twice over — no new mechanism.

**Alternatives considered**: None seriously — this is a direct, un-ambiguous match to existing
precedent.

## 4. Reading the merged field list requires no `forms.*` permission at all

**Decision**: `GET /tenant/form-fields?formKey=X` (returning the merged, ordered field *definitions* —
not values) is gated only by `requireTenantUserSession()` (any authenticated tenant user), not
`forms.manage.tenant`. The Settings > Forms *configuration* screen (which can create/edit/delete/
reorder) is what's gated by `forms.manage.tenant`, via separate `POST`/`PATCH`/`DELETE` endpoints.

**Rationale**: Spec FR-010 is explicit: filling out Department's form needs only `department.manage`,
and that form must be able to fetch the field list to render itself at all. The endpoint has no way to
know which entity-specific permission its caller holds — making the read-only definitions endpoint
open to any authenticated tenant session (no sensitive data in a field *definition*: label, type,
options, required-ness) is the only way FR-010's "not a separately permission-gated layer" is actually
true in practice, not just in spec prose.

**Alternatives considered**:
- Gating the definitions read behind `forms.manage.tenant` too, and separately behind each consuming
  module's own permission — rejected: would require this generic endpoint to somehow know about every
  possible consuming module's permission key, which breaks the "generic, form-type-agnostic" design the
  whole framework exists to provide.

## 5. Department's retrofit: values saved in the *same* transaction as the department write

**Decision**: `POST`/`PATCH /tenant/departments` (existing routes, Spec 009) gain an optional
`customFieldValues: Record<fieldKey, value>` body field. After the department row is
inserted/updated, the same handler calls `saveCustomFieldValues(request.tenantDb, "department",
departmentId, customFieldValues, mergedFields)` — a plain function call inside the *same* per-request
transaction (`tenant-context.ts` already wraps every request in one), not a second HTTP round-trip to
a `PUT /tenant/custom-field-values` endpoint.

**Rationale**: Gives the department-plus-its-custom-values write true atomicity for free (both commit
or both roll back together) — strictly better than a decoupled second call, and no extra design cost
since `saveCustomFieldValues` is a plain shared function either way. The standalone
`PUT /tenant/custom-field-values` endpoint (contracts/custom-fields-api.md) still exists, calling the
same shared function, for the framework's own completeness/testability and for any future consumer
that isn't ready to modify its own route the same way.

**Alternatives considered**:
- A separate `PUT /tenant/custom-field-values` call from the frontend, right after the department save
  succeeds — rejected: two round-trips instead of one, and a failure between them (e.g. network drop)
  would leave a department saved with no custom values and no automatic retry, a real (if narrow) data-
  consistency gap the in-transaction approach doesn't have.

## 6. Options shape, field-key slugification, and drag-reorder: smallest sufficient built-ins

**Decision**: `options` (for `select`/`multiselect`) is a plain JSON array of strings — each option's
stored value and displayed label are the same string, no separate value/label pairing in v1.
Field-key suggestion from a label is a small inline function: lowercase, trim, replace runs of
non-alphanumeric characters with `_`. Reordering a tenant's own fields uses the browser's native
`draggable` attribute and `dragstart`/`dragover`/`drop` events, restyled to the existing design system,
not a dedicated library.

**Rationale**: None of these need a new dependency (Constitution Principle XII). A plain string array
is the simplest shape that satisfies "choices for select/multiselect" as specified, with no product
requirement (in this spec) for a value distinct from its label. Native drag events are the same
"smallest built-in mechanism" choice already made for `Modal`/`Drawer` (Spec 009 research.md §6) —
consistent precedent, not a new judgment call.

**Alternatives considered**:
- `@dnd-kit` or `react-beautiful-dnd` for reordering — not proposed for sign-off: a short (single-digit
  to low-tens-length), non-virtualized, non-cross-container list is exactly what native HTML5 drag
  events handle well; a library would add real weight for no capability this spec actually needs.
- `{ value, label }` pairs for options — rejected as unnecessary for v1: nothing in the spec asks for a
  stored value that differs from its displayed choice; can be added later as a column migration if a
  real need surfaces, without disturbing existing data (existing string entries become `{value:
  x, label: x}` trivially).

## 7. Field deletion always archives — no conditional hard-delete path

**Decision**: The `DELETE` endpoint for a tenant's own field always sets an archived flag/timestamp; it
never issues a real `DELETE` against `form_fields`, regardless of whether that field has any stored
`custom_field_values`.

**Rationale**: The feature request explicitly asked this spec to flag "archive vs. hard-delete" as a
decision, defaulting to archive-and-hide. Making that the *only* behavior (rather than a conditional
"hard-delete if unused, archive if used" branch) is simpler — one code path — and structurally
eliminates any possibility of the wrong branch firing and losing data, at the cost of a small number of
never-cleaned-up rows for fields that happened to have zero values when removed (an acceptable,
explicitly-considered tradeoff, not an oversight).

**Alternatives considered**:
- Hard-delete only when zero values exist yet — rejected: the spec never actually asks for storage
  reclamation, and a conditional path is real complexity (and a second code path to test) for a benefit
  no requirement calls for.

## 8. Testing: Vitest integration tests against real Postgres, mirroring Spec 009's suite

**Decision**: New behavior (dual-visibility RLS enforcement, cross-scope key-collision rejection,
merge-order rendering, archive-preserves-values, and Department's end-to-end retrofit) is covered by
new files under `apps/api/tests/integration/`, run via the existing `vitest run` script against a real
Postgres connection.

**Rationale**: Identical reasoning to Spec 009 research.md §8 — RLS and cross-row uniqueness logic
cannot be proven "actually enforced" with a mocked database.

**Alternatives considered**: None — direct continuation of an established, working convention.
