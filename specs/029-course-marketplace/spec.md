# Feature Specification: Course Marketplace

**Feature Branch**: `029-course-marketplace`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Course Marketplace — a platform-level course catalog authored by the Super Admin and exposed to tenants for browse-and-select, for the TM multi-tenant SaaS. Today courses/course_modules/content_items are all strictly tenant-scoped (tenant_id NOT NULL, RLS-isolated) and only tenant users holding course.manage can create them — there is no super-admin course-authoring capability and no billing/payment infrastructure anywhere in the codebase. This spec adds both a platform-owned catalog and the tenant-facing selection flow, without introducing a payment processor. Scope: (1) a platform-level catalog (platform_courses, platform_course_modules, platform_course_content_items — no tenant_id, same field shape as the existing tenant-scoped equivalents) authored exclusively by Super Admin via a new Super Admin dashboard surface, gated by requireSuperAdminSession; (2) a tenant-facing marketplace browse/search/filter list and detail view of published (active) platform courses, visible to tenant users holding course.manage; (3) a selection flow with no real payment processing — free courses clone immediately into the tenant's own courses/course_modules/content_items tables on selection; paid courses create a pending marketplace_selection that a Super Admin manually marks paid/approved before the clone happens, tracked per tenant per platform course to prevent duplicate clones; (4) cloning duplicates course/module/content-item metadata rows but must not duplicate the underlying R2 file object for attachments — the cloned content item's file attachment references the same storage key as the platform original, which requires relaxing the current table-wide unique constraint on file_attachments.storage_key, and platform course content is treated as immutable once any tenant has cloned it so a tenant's copy never changes underneath it; (5) pricing reuses the existing courses.cost shape — a single flat optional cost per course, no per-seat pricing. Explicitly out of scope: any real payment processor integration and webhook/reconciliation automation; per-seat/per-learner pricing; tenant-side customization propagating back to the platform source; re-syncing an already-cloned tenant course if the platform original changes; refunds/cancellation of a paid selection. Permissions: platform-course authoring is Super Admin only; browsing and selecting is gated by the tenant's existing course.manage permission; resolving a pending paid selection is a Super Admin action. New Super Admin client pages must fetch through the existing /platform-api rewrite proxy, never a direct API origin."

## Clarifications

### Session 2026-07-21

- Q: Should marketplace courses live in new platform-level tables with no `tenant_id`, or be authored through the existing tenant-scoped `courses` table via a special "platform" pseudo-tenant? → A: New platform-level tables (`platform_courses`, `platform_course_modules`, `platform_course_content_items`) with no `tenant_id` at all — the existing tenant-isolation model (Principle I) assumes `tenant_id` identifies a real customer; stretching it to mean "the platform itself" would weaken that invariant for every other query that scopes by it.
- Q: With no billing/payment infrastructure anywhere in the codebase today, what should "pay" mean in this spec? → A: No real payment processor. Selecting a free course clones it immediately. Selecting a paid course records a pending request that a Super Admin manually marks paid/approved (offline reconciliation) before the clone happens. Real processor integration (e.g. Stripe) is explicitly deferred to a future spec.
- Q: When a tenant selects a platform course, how does its curriculum become available to that tenant's learners — and how does that interact with SCORM packages and other uploaded files, which can be large? → A: Hybrid. Clone the `courses`/`course_modules`/`content_items` metadata rows into the tenant's own existing tables (so every downstream feature — Learner Progress, SCORM Runtime, Training Requests, TNA — works against the clone completely unmodified), but never duplicate the underlying R2 object for an attached file — the cloned content item's attachment record points at the same storage key as the platform original. This requires relaxing `file_attachments`' current table-wide unique constraint on `storage_key` (today only one attachment row may reference a given object) and treating a platform course's files as immutable once any tenant has cloned it, so a tenant's copy never changes underneath it.
- Q: What pricing shape should a platform course support? → A: A single flat optional cost per course, mirroring the existing `courses.cost` field exactly (null/0 = free). No per-seat or per-learner pricing in this spec.
- Q: Given `courses.category_id` is a foreign key into a *tenant's own* `course_categories` (tenant-configurable per spec 023), and a platform course has no tenant to own a category — how should platform-course categorization work? → A: A platform course stores its category as a plain name (text), not a foreign key. On clone, the existing category auto-create-or-match-by-name logic from spec 023 (already implemented in `course-category-resolution.ts` for tenant-authored courses) resolves that name against the receiving tenant's own category list — creating it if it doesn't exist yet, matching case-insensitively if it does. No new category concept is introduced; the platform layer just supplies a name instead of an id.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Super Admin builds a platform course shell (Priority: P1)

A Super Admin creates a platform course — title, category name, delivery mode, duration, and
optionally description, provider, and cost — so it exists as a draft in the platform catalog before any
curriculum is attached.

**Why this priority**: Nothing else in this spec — curriculum authoring, tenant browsing, selection —
is possible without a platform course record to attach to.

**Independent Test**: As an authenticated Super Admin, submit a create request with the required
fields and confirm a new platform course appears with status `draft` and audit fields populated.

**Acceptance Scenarios**:

1. **Given** an authenticated Super Admin, **When** they submit a platform course with all required
   fields, **Then** it is created with status `draft` and `created_by`/`created_at` recorded.
2. **Given** a create request missing a required field (title, category, delivery mode, or duration),
   **When** submitted, **Then** it is rejected with a clear error identifying the missing field(s).
3. **Given** a create request with an invalid `deliveryMode`, `duration.unit`, or negative `cost`,
   **When** submitted, **Then** it is rejected with a clear validation error.
4. **Given** an unauthenticated caller, or a caller without a valid Super Admin session, **When** they
   attempt to create, update, or delete a platform course, **Then** the request is rejected — this
   endpoint is not reachable via any tenant permission, regardless of what a tenant user holds.
5. **Given** an existing platform course, **When** a Super Admin updates its fields (including status,
   directly, no restricted transition graph — same as spec 023's own courses table), **Then** the
   changes persist and audit fields refresh.

---

### User Story 2 - Super Admin builds a platform course's curriculum (Priority: P1)

A Super Admin adds modules and content items (video, article, live class, test/assignment shell,
external import, including real SCORM package upload) to a platform course, using the same authoring
model already available for tenant-owned courses.

**Why this priority**: A platform course with no curriculum has nothing for a tenant to evaluate before
selecting it, and nothing to clone — this is the payload the rest of the spec depends on existing.

**Independent Test**: As a Super Admin, add a module and one content item of each supported type to a
platform course, including uploading a small file to one content item, and confirm each is created and
appended correctly with its type-specific fields and attachment intact.

**Acceptance Scenarios**:

1. **Given** a platform course, **When** a Super Admin creates a module with a title, **Then** it is
   appended as the course's last module (append-only creation, same convention as spec 024).
2. **Given** a platform module, **When** a Super Admin creates a content item of any of the six
   supported types (`video`, `article`, `live_class`, `test`, `assignment`, `external_import`) with
   that type's required fields, **Then** it is created and appended as the module's last item, using the
   same type-specific validation rules already established for tenant content items (spec 024).
3. **Given** a platform content item that accepts a file (e.g. a document, or a SCORM `.zip` for an
   `external_import` item with `sourceType: "scorm"`), **When** a Super Admin uploads a file to it,
   **Then** it is stored in R2 and attached to that content item, using the same presigned-upload flow
   already established for tenant content items (spec 025), scoped to the platform layer rather than a
   tenant.
4. **Given** a platform course's modules or content items, **When** a Super Admin reorders them or
   edits their fields, **Then** the changes are reflected on the next curriculum read (same reorder/edit
   conventions as spec 024).
5. **Given** a caller without a valid Super Admin session, **When** they attempt any curriculum-authoring
   action on a platform course, **Then** the request is rejected.

---

### User Story 3 - Tenant browses the marketplace (Priority: P1)

A tenant user holding `course.manage` browses the list of published platform courses, searches by
title, filters by category/delivery mode/cost, and opens one to see its full detail including
curriculum outline, before deciding whether to select it.

**Why this priority**: The marketplace's entire value to a tenant is being able to discover and
evaluate what's available — independently testable as soon as User Stories 1-2 can produce published
platform courses to browse.

**Independent Test**: With several platform courses in a mix of statuses, categories, and costs, list
them as a tenant user holding `course.manage`, confirm only `active` ones appear, confirm search/filter
narrows correctly, and open one to confirm its full detail (including modules/content-item outline) is
returned.

**Acceptance Scenarios**:

1. **Given** platform courses in `draft`, `active`, and `archived` status, **When** a tenant user
   holding `course.manage` lists the marketplace, **Then** only `active` platform courses are returned.
2. **Given** the marketplace list, **When** the user searches by a title substring or filters by
   category, delivery mode, or cost (free vs. paid), **Then** only matching courses are returned.
3. **Given** an `active` platform course, **When** a tenant user holding `course.manage` requests its
   detail, **Then** its full metadata and curriculum outline (modules and content items, same shape as
   a tenant's own course curriculum read) are returned, without exposing any other tenant's cloned
   copies or selection state.
4. **Given** a platform course in `draft` or `archived` status, **When** a tenant user requests it by
   id directly, **Then** the request is rejected as not found (drafts and archived courses are never
   tenant-visible, regardless of how they're reached).
5. **Given** a tenant user holding only `course.view` (no `course.manage`), **When** they attempt to
   browse or view the marketplace, **Then** the request is rejected as forbidden.

---

### User Story 4 - Tenant selects a free course (Priority: P1)

A tenant user holding `course.manage` selects a free (`cost` null/0) platform course, and it becomes
immediately available in their own tenant's course catalog with its full curriculum, ready to assign
and track like any course the tenant authored itself.

**Why this priority**: This is the marketplace's core payoff for the common case — most of a platform
catalog is expected to be free onboarding/compliance-style content — and is independently demoable end
to end once User Stories 1-3 exist.

**Independent Test**: As a tenant user holding `course.manage`, select a free platform course with two
modules and confirm a new course appears in the tenant's own catalog with matching modules and content
items, editable and assignable exactly as if authored directly.

**Acceptance Scenarios**:

1. **Given** an `active`, free platform course, **When** a tenant user holding `course.manage` selects
   it, **Then** a new course, its modules, and its content items are created in that tenant's own
   catalog (same tables tenant-authored courses live in), each content item's file attachments (if any)
   pointing at the same storage key as the platform original rather than a duplicated copy.
2. **Given** a platform course whose category name doesn't yet exist in the selecting tenant's category
   list, **When** it is cloned, **Then** the category is auto-created for that tenant (same
   resolve-or-create-by-name behavior already used for tenant-authored course creation, spec 023).
   Given a category name that already exists (case-insensitively), **When** cloned, **Then** the
   course is associated with the existing tenant category — no duplicate is created.
3. **Given** a tenant that has already selected a given platform course, **When** the same tenant
   attempts to select it again, **Then** the request is rejected — one clone per tenant per platform
   course, not duplicated.
4. **Given** a successful clone, **When** the platform course's own content is later inspected, **Then**
   it is unchanged — cloning never mutates the platform source.
5. **Given** a tenant user holding only `course.view`, **When** they attempt to select a course, **Then**
   the request is rejected as forbidden.

---

### User Story 5 - Tenant requests a paid course, Super Admin approves it (Priority: P2)

A tenant user holding `course.manage` selects a paid platform course, which records a pending request
rather than cloning immediately; a Super Admin reviews the queue of pending requests and marks one as
paid/approved, which triggers the same clone behavior as the free-course path.

**Why this priority**: Extends User Story 4 to the paid case, which is a smaller and less common slice
of the catalog and depends on it already working; independently testable once User Story 4's clone
mechanism exists.

**Independent Test**: As a tenant user holding `course.manage`, select a paid platform course and
confirm no course appears yet in the tenant's catalog; as a Super Admin, mark that pending selection as
paid, and confirm the clone now appears in the tenant's catalog exactly as in User Story 4.

**Acceptance Scenarios**:

1. **Given** an `active`, paid (`cost` > 0) platform course, **When** a tenant user holding
   `course.manage` selects it, **Then** a `marketplace_selections` record is created with status
   `requested`, and no clone is created yet.
2. **Given** a tenant with a `requested` selection for a platform course, **When** the same tenant
   attempts to select that course again, **Then** the request is rejected — one pending/resolved
   selection per tenant per platform course.
3. **Given** a `requested` selection, **When** a Super Admin marks it `paid`, **Then** the clone runs
   immediately (same behavior as User Story 4 Scenario 1) and the selection's status updates to
   `fulfilled` with the resulting cloned course id recorded.
4. **Given** a `requested` selection, **When** a Super Admin instead marks it `rejected`, **Then** no
   clone is created, and the tenant may submit a new selection request for that course later.
5. **Given** a Super Admin's queue of pending selections, **When** they list it, **Then** every
   `requested` selection is returned with enough context (tenant, platform course, requested by/at) to
   decide on it, across all tenants.
6. **Given** a caller without a valid Super Admin session, **When** they attempt to resolve a pending
   selection, **Then** the request is rejected. **Given** a tenant user, **When** they attempt to
   resolve any selection (their own or another tenant's), **Then** the request is rejected — resolution
   is a Super Admin–only action.

---

### Edge Cases

- What happens when a Super Admin archives a platform course after tenants have already cloned it? The
  platform course becomes invisible to new marketplace browsing/selection; already-cloned tenant copies
  are entirely unaffected (clones are independent once created, per Clarifications).
- What happens when a Super Admin attempts to replace or delete a file attached to a platform content
  item that at least one tenant has already cloned? Rejected — platform course content is immutable
  once any tenant has cloned it, so a tenant's copy never changes underneath it (Clarifications). A
  platform course with zero clones may still be freely edited.
- What happens when a platform course is deleted (not archived) while it has zero clones? Allowed, same
  hard-delete-only-before-any-dependency pattern as spec 024's modules/content items. Deletion of a
  platform course that has one or more clones is rejected — same rationale as the immutability rule
  above, delete is a stronger case of "change" than edit.
- What happens when a tenant's selection request targets a platform course id that doesn't resolve, or
  resolves but is not `active`? Rejected as not found — same response shape whether the id is invalid,
  belongs to a draft/archived course, or doesn't exist at all, so a tenant can't distinguish "doesn't
  exist" from "not published yet."
- What happens when two selection requests for the same free platform course from the same tenant race
  each other? Exactly one clone is created; the second request is rejected as a duplicate selection
  (User Story 4 Scenario 3), enforced server-side, not merely a client-side guard.
- What happens when a platform course has zero modules (nothing built yet)? It is still listable and
  selectable per its `active` status — the resulting tenant clone simply has zero modules too, same as
  a tenant course with no curriculum yet in spec 024.
- What happens when a request omits authentication entirely, on either the Super Admin or tenant side?
  Rejected as unauthorized, before any permission or status check runs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow an authenticated Super Admin to create a platform course with a
  required title, category (name), delivery mode, and duration, and optional description, provider, and
  cost; every new platform course starts as `draft`.
- **FR-002**: System MUST allow an authenticated Super Admin to update a platform course's fields,
  including `status` directly (no restricted transition graph, same as spec 023's courses table), and
  to list/search/filter and fetch platform courses by id.
- **FR-003**: System MUST allow an authenticated Super Admin to create modules on a platform course and
  content items on a platform module, using the same append-only-on-create, six-type
  (`video`/`article`/`live_class`/`test`/`assignment`/`external_import`) content-item model and
  per-type field validation already established for tenant course content (spec 024), to edit and
  reorder both, and to delete a content item or a module (cascading to its content items).
- **FR-004**: System MUST allow an authenticated Super Admin to upload a file and attach it to a
  platform content item, using the same presigned-direct-to-R2 upload flow already established for
  tenant content items (spec 025), and — where the content item is an `external_import` with
  `sourceType: "scorm"` — to import a real SCORM 1.2 package the same way spec 027 already does for
  tenant content items, producing one platform content item per SCO exactly as spec 027 does today for
  tenant-owned packages.
- **FR-005**: System MUST reject every platform-course authoring action (create/update/delete of a
  platform course, module, or content item; file upload/attach) from a caller without a valid Super
  Admin session — no tenant permission, including `course.manage`, grants access to this authoring
  surface.
- **FR-006**: System MUST allow a tenant user holding `course.manage` to list and search/filter platform
  courses whose status is `active`, and to fetch one by id, returning its full metadata and curriculum
  outline; `draft` and `archived` platform courses MUST be indistinguishable from nonexistent ones to
  every tenant caller, including by direct id lookup.
- **FR-007**: System MUST reject marketplace browse/detail requests from a tenant user who lacks
  `course.manage`.
- **FR-008**: System MUST allow a tenant user holding `course.manage` to select an `active` platform
  course. If its `cost` is null or 0, the system MUST immediately clone the platform course, its
  modules, and its content items into that tenant's own `courses`/`course_modules`/`content_items`
  tables. If its `cost` is greater than 0, the system MUST instead create a `marketplace_selections`
  record with status `requested` and MUST NOT clone anything yet.
- **FR-009**: System MUST reject a selection request for a platform course the caller's tenant has
  already selected (an existing `requested`, `paid`, or `fulfilled` selection for that
  tenant/platform-course pair) — at most one non-`rejected` selection may exist per tenant per platform
  course at a time.
- **FR-010**: When cloning (whether immediate, for a free course, or triggered by a Super Admin marking
  a paid selection as `paid`), the system MUST: resolve the course's category name against the target
  tenant's own category list using the existing resolve-or-create-by-name matching logic (spec 023),
  auto-creating it if absent; create a new `file_attachments` row for the target tenant referencing the
  *same* `storage_key` as each platform content item's attachment, without re-uploading or duplicating
  the underlying R2 object; and record the resulting tenant course id back on the
  `marketplace_selections` record (for paid courses) with status `fulfilled`.
- **FR-011**: System MUST allow an authenticated Super Admin to list pending (`requested`) marketplace
  selections across all tenants, and to resolve one by marking it `paid` (triggering the clone per
  FR-010) or `rejected` (no clone; the tenant may submit a new selection later).
- **FR-012**: System MUST reject selection-resolution actions (marking a selection `paid` or `rejected`)
  from any caller without a valid Super Admin session, including a tenant user attempting to resolve
  their own tenant's selection.
- **FR-013**: System MUST reject any edit to a platform content item's attached file (replace or delete)
  once at least one `fulfilled` selection references that platform course, and MUST reject deletion of a
  platform course, module, or content item once at least one `fulfilled` selection references that
  platform course.
- **FR-014**: System MUST record `createdBy`/`createdAt` on creation and `updatedBy`/`updatedAt` on every
  subsequent change, for platform courses, platform modules, platform content items, and
  `marketplace_selections`.
- **FR-015**: System MUST NOT integrate any real payment processor, issue any charge, or handle any
  webhook/reconciliation in this feature — a paid selection's `paid` status is set manually by a Super
  Admin based on payment handled entirely outside the system.
- **FR-016**: System MUST NOT support per-seat or per-learner pricing, refunds, cancellation of a
  `fulfilled` selection, or re-syncing a tenant's already-cloned course when its platform source
  changes — all explicitly deferred as flagged future work.

### Key Entities *(include if feature involves data)*

- **Platform Course**: A platform-level (no `tenant_id`) course-catalog entry authored by Super Admin.
  Same field shape as the existing tenant-scoped `courses` entity — title, description, category
  (stored as a name, not a tenant category id, since there is no tenant to own one), delivery mode,
  duration, provider, cost (optional; null/0 = free), status (`draft`/`active`/`archived`), and audit
  fields. Becomes immutable (content-wise) once any tenant has a `fulfilled` selection referencing it.
- **Platform Course Module**: A platform-level, ordered section within exactly one Platform Course.
  Same shape as the tenant-scoped `course_modules` entity.
- **Platform Course Content Item**: A platform-level, ordered, polymorphic unit of curriculum content
  within exactly one Platform Course Module. Same six-type shape and per-type fields as the tenant-scoped
  `content_items` entity (spec 024), including file attachments (spec 025) and SCORM package import
  (spec 027).
- **Marketplace Selection**: Tracks one tenant's relationship to one platform course — which tenant,
  which platform course, status (`requested`/`paid`/`rejected`/`fulfilled`), who requested it and when,
  who resolved it and when, and (once `fulfilled`) the id of the resulting cloned course in the tenant's
  own catalog. At most one non-`rejected` record exists per tenant/platform-course pair.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can build a complete platform course (metadata, modules, content items
  across all six types, and at least one uploaded file) using only the platform-authoring endpoints,
  with no tenant-side involvement.
- **SC-002**: A tenant user holding `course.manage` can go from browsing the marketplace to having a
  fully usable, assignable course in their own catalog — for a free course, in a single selection
  action with no additional steps.
- **SC-003**: 100% of platform-course authoring actions attempted without a valid Super Admin session
  are rejected, verified by automated test.
- **SC-004**: 100% of marketplace browse/select actions attempted by a tenant user lacking
  `course.manage`, or targeting a non-`active` platform course, are rejected, verified by automated
  test.
- **SC-005**: 100% of clones (free or paid-resolved) reuse the original file's storage object — zero
  duplicate R2 objects are created as a result of any selection, verified by automated test asserting
  identical `storage_key` values between a platform content item's attachment and its tenant clone's
  attachment.
- **SC-006**: 100% of attempts to select a platform course a tenant has already selected (non-rejected)
  are rejected, verified by automated test — no tenant ever ends up with two clones of the same platform
  course.
- **SC-007**: 100% of edit/delete attempts against a platform course, module, content item, or its
  attached file are rejected once that platform course has at least one `fulfilled` selection, verified
  by automated test.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Introduces the first platform-level (no-`tenant_id`) catalog
  tables in the schema, authored and readable only through Super Admin session auth — never through
  tenant RLS/permission paths. This does not weaken tenant isolation (Principle I): tenants never read
  or write platform tables directly, only a Super-Admin-only authoring surface and a narrow
  read-only/select surface gated by existing tenant permission checks. The output of a selection is an
  ordinary tenant-scoped course, indistinguishable from a tenant-authored one, so every existing
  tenant-isolation guarantee downstream (progress tracking, SCORM runtime, RLS) is unchanged.
- **Tenant-configurable vs. fixed platform-wide**: No new tenant permission keys — marketplace browsing
  and selection reuse `course.manage` exactly as already granted (Clarifications, locked scope). A
  platform course's category is supplied as a name and resolved into the *tenant's own* configurable
  category list on clone (reusing spec 023's existing resolve-or-create logic) — the platform layer
  itself has no fixed or tenant-configurable category taxonomy of its own, it only ever contributes a
  name for the tenant's taxonomy to absorb.
- **AI-generation review/approval step**: N/A — this spec is manual authoring (by Super Admin) and manual
  selection (by tenant) only; no AI-generated content is produced or ingested here.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec touches no evaluation or ROI data.
- **Downgrade/cancellation behavior**: N/A for tenant plan-tier downgrade — no plan-tier gating exists
  anywhere in the codebase yet (see Assumptions), so this feature is not gated by one. Not a security or
  evaluation module. A *paid-selection* cancellation/refund concept does not exist in this spec (FR-016)
  and is explicitly deferred.
- **Design system reference**: New UI is in scope on both sides — a Super Admin marketplace-authoring
  surface and a tenant-facing browse/select surface — unlike specs 023-025/027 which were API-only. Both
  MUST be built against the established design system (Principle V) via the ui-ux-pro-max skill, the
  same as every other dashboard surface; no new ad hoc styling. The Super Admin side MUST fetch through
  the existing `/platform-api` rewrite proxy, never a direct API origin (per the documented Super Admin
  cookie cross-origin fix), and MUST be verified in a real browser, not only via `.inject()`-style tests.
- **Demoable vs. internal**: Stakeholder-demoable end to end — a Super Admin can be shown authoring a
  course and a tenant can be shown discovering and selecting it, unlike the API-only specs (023-025,
  027) that preceded it in this catalog's build-out.

## Assumptions

- No tenant plan-tier gating mechanism exists anywhere in the codebase yet (no `plan`/`tier` field on
  the tenants table). This feature is therefore available to all tenants regardless of plan in v1; if a
  plan-tier concept is introduced later, gating the marketplace (or specific platform courses) behind it
  is flagged as a natural future extension, not silently assumed here.
- Platform course content items reuse the full content-item capability set as it exists *today* —
  including real file upload (spec 025) and real SCORM 1.2 package hosting/playback (spec 027) — not
  the more limited external-URL-only stubs from spec 024's original scope, since those capabilities have
  since been built for the tenant-scoped equivalent this spec mirrors.
- File attachments for platform course content items require relaxing `file_attachments`'
  `storage_key` uniqueness (currently table-wide, one row per object) so that both a platform
  attachment row and each tenant clone's attachment row can reference the same `storage_key` without
  violating a constraint — this is data-model work this spec's plan MUST address explicitly, not a
  reinterpretation left implicit.
- Cloning is a one-time, one-directional copy: once created, a tenant's cloned course is a completely
  ordinary tenant-owned course, editable and deletable like any other, with no further link back to its
  platform source beyond the historical `marketplace_selections` record. Edits a tenant makes to their
  clone never propagate back to the platform course, and edits to the platform course (where still
  permitted, i.e. before any clone exists) never propagate to existing clones — there are none yet to
  propagate to, since clones only happen once immutability applies.
- A platform course becomes immutable (its content, not its top-level metadata like title/description/
  cost/status) only once at least one `fulfilled` selection exists; a platform course with zero clones
  remains fully editable, including replacing an attached file. This matches the "tenant's copy never
  unexpectedly changes underneath it" requirement while not freezing a platform course that nothing has
  selected yet.
- Deleting a platform course, module, or content item is a hard delete, same as spec 024's tenant
  equivalents, and is blocked entirely (not soft-archived) once any `fulfilled` selection exists for
  that platform course, per the immutability rule above.
- A rejected marketplace selection does not block a future selection attempt for the same
  tenant/platform-course pair — only a `requested`, `paid`, or `fulfilled` selection does (FR-009).
- This spec assumes the platform-level content-item authoring surface (modules, content items, file/
  SCORM upload) is functionally a parallel implementation of the same rules already specified for
  tenant content items in specs 024/025/027, rather than re-deriving those rules from scratch — the plan
  for this spec should reuse that existing validation/upload/import logic against the platform tables
  wherever the code structure allows, rather than duplicating it wholesale.
