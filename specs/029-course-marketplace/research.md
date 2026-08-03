# Phase 0 Research: Course Marketplace

## §1. Relaxing `file_attachments.storage_key` uniqueness

**Decision**: Drop `file_attachments_storage_key_unique` (`apps/api/drizzle/0079_file_attachments_table.sql`)
entirely via a new migration. Do not replace it with a scoped unique index (e.g. per `entity_id`) —
once a clone exists, the *same* `storage_key` legitimately appears on two different `file_attachments`
rows (the tenant's own content item's attachment, and — indirectly, via `platform_file_attachments`,
see §2 — the platform original's), so no uniqueness invariant on `storage_key` alone survives this
feature.

**Rationale**: The constraint's original purpose (research.md of spec 025) was "one attachment record
per uploaded object" as a sanity check, not a security boundary — actual object identity/uniqueness in
R2 is guaranteed by the upload-time key generation (a fresh UUID-based path per upload), not by this
Postgres constraint. Removing it doesn't weaken anything; it just stops asserting an invariant that a
legitimate new code path (cloning) needs to violate.

**Alternatives considered**: A unique index on `(entity_id, storage_key)` — rejected, redundant with
uniqueness already implied by `entity_id` alone (a content item has at most one attachment today, per
spec 025's scope) and doesn't solve the actual problem (two *different* `entity_id`s, tenant clone vs.
none — platform originals don't even live in this table, see §2 — sharing one `storage_key`).

## §2. Platform-level file attachments: separate table, not a nullable-`tenant_id` reuse

**Decision**: Introduce `platform_file_attachments` as its own table — same shape as `file_attachments`
(`entity_type`/`entity_id` polymorphic, `file_name`/`content_type`/`size_bytes`/`storage_key`/`status`)
but with **no** `tenant_id` column, `entity_type` fixed to `'platform_content_item'`, and its own
`storage_key` uniqueness (safe here — nothing ever clones *into* this table, only *out of* it, so no
row here is ever a clone target).

**Rationale**: `file_attachments.tenant_id` is `NOT NULL` and RLS-enforced. Making it nullable to
accommodate platform-owned rows would touch every existing RLS policy's assumption (`tenant_id =
current_setting(...)`, which is never true for a NULL) and every existing query path that reads this
table, for the sake of a handful of platform-authored rows. A dedicated table with the identical shape
costs one small schema file and zero risk to the existing tenant-attachment surface — consistent with
how `course_category_templates` (platform-wide) and `course_categories` (tenant-owned) are already two
separate tables rather than one nullable-`tenant_id` table (spec 023's own precedent).

**Alternatives considered**: Nullable `tenant_id` on the existing table — rejected per above. A single
polymorphic table keyed by a `scope` discriminator (`platform` vs `tenant`) — rejected, adds a branch to
every single query against a table whose entire existing RLS/grant model assumes one scope, for a
feature that only needs the platform side to hold a handful of rows.

## §3. Cross-tenant read of `marketplace_selections` for the Super Admin queue

**Decision**: `marketplace_selections` carries `tenant_id`, `NOT NULL`, with RLS `ENABLE`+`FORCE`
and **two** policies, mirroring `apps/api/drizzle/` migrations for `tenants`/`user_sessions` exactly:

```sql
CREATE POLICY "tenant_isolation" ON "marketplace_selections"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "super_admin_full_access" ON "marketplace_selections"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```

A tenant user's own selection reads/writes go through `request.tenantDb` (existing `tenant-context.ts`
plugin — `tenant_isolation` policy applies, scoped to their own tenant). The Super Admin's
list-pending-across-all-tenants query goes through `request.superAdminDb` (existing
`super-admin-context.ts` plugin — sets `app.is_super_admin = 'true'`, so `super_admin_full_access`
applies regardless of `tenant_id`).

**Rationale**: This is not a new pattern — `super-admin-context.ts`'s own doc comment explicitly
anticipates it ("subject to the Super Admin RLS allowance clause future tenant-scoped tables adopt").
`marketplace_selections` is simply the first *new* table (since `tenants`/`user_sessions`) to actually
need it.

**Alternatives considered**: Querying via `fastify.db` (no transaction-local GUCs set at all) —
rejected, would return zero rows against an RLS-forced table (neither policy's qual is true when
neither GUC is set), the same trap `super-admin-context.ts`'s own nil-UUID-pin comment documents for a
stale-connection edge case.

## §4. Writing a clone into a *specific* target tenant from a Super-Admin-triggered flow

**Decision**: Extract `provisionTenant`'s (`apps/api/src/provisioning/provision-tenant.ts`) inline
pattern — manually `pool.connect()`, `BEGIN`, `set_config('app.tenant_id', $1, true)` to an
explicitly-chosen tenant id, `drizzle(client)` — into a small reusable helper,
`withTenantConnection(pool, tenantId, fn)`, in `apps/api/src/db/with-tenant-connection.ts`. Both the
Super-Admin paid-selection-resolution route (target tenant is whatever the resolved
`marketplace_selections` row names, not the caller's own) and — optionally, for consistency —
`provisionTenant` itself use it.

**Rationale**: `request.superAdminDb` (§3) is pinned to the **nil UUID** for `app.tenant_id` (by
design — it represents "no specific tenant," per its own doc comment) and therefore cannot satisfy
`tenant_isolation`'s `WITH CHECK` on any real tenant's rows; it is the wrong connection for *writing*
into one specific tenant's `courses`/`course_modules`/`content_items`/`file_attachments`. A second,
purpose-built connection with `app.tenant_id` set to the real target tenant is required — exactly what
`provisionTenant` already had to solve for the same underlying reason (writing tenant-scoped seed data
from a Super-Admin-initiated action). Extracting it avoids a second inline copy of transaction/GUC/
release bookkeeping.

**Alternatives considered**: Giving the DB role `BYPASSRLS` — rejected, weakens the isolation guarantee
for every query issued by that role, not just this one flow (Principle I: isolation must be enforced at
the data layer, not opted out of broadly). Duplicating `provisionTenant`'s inline block a second time —
acceptable but strictly worse than extracting a five-line helper once two call sites exist.

## §5. Clone function shape and its two call sites

**Decision**: One function, `clonePlatformCourseIntoTenant(tenantDb, tenantId, platformCourseId,
createdByUserId)` in `apps/api/src/course-marketplace/clone-platform-course.ts`, parameterized only on
the `tenantDb` connection it's given — it never opens its own connection or cares how it got one. Two
call sites:
1. **Free-course immediate clone** (tenant marketplace-select route): called with `request.tenantDb`
   — already scoped to the selecting tenant by the normal per-request flow.
2. **Paid-course resolution** (Super Admin marks a selection `paid`): called with a connection from
   `withTenantConnection(pool, selection.tenantId, ...)` (§4) — scoped to whichever tenant the
   `marketplace_selections` row names, not the Super Admin's own (nonexistent) tenant.

Internally it: (a) resolves the platform course's category name via the existing
`resolveOrCreateCourseCategory` (spec 023, unchanged, already tenant-generic — takes `tenantDb`/
`tenantId`/name); (b) inserts one `courses` row, then one `course_modules` row per platform module
(preserving `position`), then one `content_items` row per platform content item (preserving `position`,
`type`, `payload`); (c) for each platform content item that has a `platform_file_attachments` row,
inserts a new `file_attachments` row for the target tenant with the **same** `storage_key` (never calls
`storage.ts`'s upload path — no bytes move); (d) returns the new `courses.id`.

**Rationale**: A single shared function guarantees the free and paid paths can never drift (e.g. one
path forgetting the category-resolution step) — spec FR-010 describes one clone behavior, not two.

**Alternatives considered**: Two separate implementations (one per call site) — rejected, directly
risks the two paths silently diverging, which the spec's FR-010 and User Story 5's "triggers the same
clone behavior as the free-course path" language explicitly rules out.

## §6. Platform course/module/content-item authoring: reusing spec 024/025/027 logic

**Decision**: `validateContentItemPayload` (`apps/api/src/course-content/content-item-payload-validation.ts`)
is already a pure function of `(type, payload)` with no tenant dependency — imported directly into
`platform-course-content-routes.ts`, unmodified. `storage.ts`'s exported functions
(`createPresignedUploadUrl`, `headObject`, `createPresignedDownloadUrl`, `deleteObject`) are already
key-based with no tenant dependency — imported directly into `platform-course-file-routes.ts`,
unmodified. Spec 027's SCORM manifest-parsing (`imsmanifest.xml` → SCO tree) is expected to already be
factored as a function of "package bytes in, SCO list + entry points out" independent of which table the
resulting content items get written to (mirroring the same "pure logic vs. DB write" split
`content-item-payload-validation.ts` already demonstrates) — `platform-course-file-routes.ts` calls that
same parsing function and writes its own `platform_course_content_items` rows, rather than
`tenant_scorm_upload_routes.ts`'s tenant-table writes.

**Rationale**: Constitution Principle XII's spirit (prefer reuse over reinvention) applies to internal
logic reuse just as much as it does to avoiding new npm packages — this spec should not re-derive
SCORM manifest parsing or content-type validation rules a second time.

**Flagged for implementation-phase verification**: If spec 027's manifest-parsing code turns out to be
more tightly coupled to tenant-table writes than assumed here (i.e., not already split into a pure
parse step), a small refactor to extract that pure function is in scope for this spec's tasks — not a
blocker to this plan, but called out explicitly rather than silently discovered mid-implementation.

## §7. UI: first course-catalog spec with a real frontend

**Decision**: Both new surfaces (Super Admin authoring under `(platform-shell)/admin/course-marketplace/`,
tenant browse/select under `(dashboard-shell)/learning/marketplace/`) are built via the `ui-ux-pro-max`
skill against whatever design system is already established (Principle V) — not ad hoc. The Super Admin
pages fetch exclusively through the existing `/platform-api` rewrite proxy (`apps/web/next.config.ts`),
never `NEXT_PUBLIC_API_URL`/a direct API origin, per the documented cross-origin-cookie fix; the tenant
pages use whatever fetch pattern the tenant dashboard shell already establishes elsewhere (subdomain
routing, spec 004 — same-origin by construction, no proxy needed).

**Rationale**: Specs 023–025/027 deliberately stayed API-only; this is the first spec in the sequence
where the feature's own value (browse-and-select) is inherently a UI interaction, not just a
data/API capability — matches the Input's explicit "Super Admin dashboard surface"/"tenant-facing
marketplace" language, and is called out as a deliberate scope deviation in spec Constitution Alignment.

**Alternatives considered**: Shipping API-only again and deferring UI to a follow-up spec (the
023/024/025/027 pattern) — rejected for this spec specifically, since "browse and select" has no
non-UI form that delivers the feature's actual value to a tenant admin; an API-only version would be
demoable only via raw HTTP calls, which fails Principle IX's demoable/internal honesty bar for a feature
whose entire point is tenant self-service discovery.

## §8. Testing

**Decision**: Vitest integration tests against a real Postgres connection, same convention as every
prior spec in this sequence. New tests specifically assert: (a) zero platform-authoring access without
`requireSuperAdminSession` (mirrors `course-content-permission-tenant-isolation.test.ts`'s shape); (b)
identical `storage_key` between a platform content item's `platform_file_attachments` row and its
clone's `file_attachments` row after a select (SC-005); (c) a second selection attempt for the same
tenant/platform-course pair is rejected (SC-006); (d) platform-course edit/delete/file-replace is
rejected once a `fulfilled` selection exists (SC-007). Real-browser verification (not `.inject()`-only)
required for both new UI surfaces before either is considered done, per the Super Admin cookie lesson.
