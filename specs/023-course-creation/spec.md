# Feature Specification: Course Creation

**Feature Branch**: `023-course-creation`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "Course Catalog / Course Creation — data model and API only (no web UI yet) for the TM multi-tenant SaaS. This is the foundational \"Courses\" entity that Training Requests, Training Needs Analysis, and Learning Plans will reference in later specs (the dashboard nav already has a disabled \"Courses\" placeholder waiting for this). Scope: a tenant-scoped courses table (title, description, category, delivery mode e.g. in-person/virtual/self-paced, duration, provider/vendor, cost, status such as draft/active/archived, and audit fields), plus CRUD API endpoints (create, list with search/filter, get by id, update, archive/soft-delete) under a new tenant API surface. Gate access with new granular permissions course.view and course.manage, following the same permission-gating pattern already used for department.view/department.manage and training_request.view.\*/manage.\* (view-only holders can list/read; manage holders can create/edit/archive). No bulk actions, no versioning, no file/attachment upload in this first spec — keep it to the same scope depth as the Department Management spec (009) but for courses, API-only."

## Clarifications

### Session 2026-07-18

- Q: Should course content (modules/lessons: videos, articles, live classes) be part of this spec, or a separate follow-up spec? → A: Separate follow-up spec — this spec covers only the course entity itself (title, category, status, etc.); a later "Course Content" spec adds the curriculum structure once the course shell exists.
- Q: How should the different content types (video, article, live class) eventually be modeled? → A: A single polymorphic `content_items` table with a `type` discriminator and a flexible per-type payload, referencing a course by id — noted here only so this spec's schema doesn't foreclose that direction; the content model itself is designed in the follow-up spec.
- Q: Should course category be a fixed platform-wide list, or tenant-configurable? → A: Tenant-configurable — every tenant is seeded with a default set of categories (Leadership, Compliance, Technical, Soft Skills, Onboarding, Other) at provisioning, and a user holding `course.manage` can add a new category by simply specifying a name that doesn't already exist while creating or editing a course (auto-created inline, no separate category-management step required). This follows Constitution Principle II/III (org-structure-like data is tenant-configurable, not a fixed enum) — the same reasoning already applied to departments.
- Q: Should the duration unit be a fixed enum or free text? → A: Fixed enum — `minutes` / `hours` / `days`. Unlike category, duration units aren't a tenant taxonomy concept; a fixed set keeps duration numerically comparable/sortable across the catalog. (Whether duration should later be auto-calculated from a course's content items once the follow-up Course Content spec exists is an open question flagged in Assumptions for that spec to resolve — not part of this spec, since no content exists here to calculate from.)
- Q: Can the general update endpoint set a course's status to any value directly, including un-archiving (`archived` → `active`), or should status changes be restricted to specific transitions? → A: Update allows any status value directly — no restricted transition graph in this spec. Un-archiving a course is just a normal update via the same endpoint as any other field edit; the dedicated archive action (FR-006) is a convenience for the common "retire this course" case, not the only way to reach `archived`, and not the only way to leave it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a course to the catalog (Priority: P1)

An L&D admin holding `course.manage` creates a new course record — title, category, delivery mode,
duration, and (optionally) description, provider/vendor, and cost — so it exists in the tenant's
catalog for later use by Training Requests, Training Needs Analysis, and Learning Plans.

**Why this priority**: Nothing else in this spec (or the specs that will build on it) is possible
without a way to create a course record in the first place.

**Independent Test**: As a user holding `course.manage`, submit a create request with the required
fields and confirm a new course appears in the tenant's catalog with status `draft` and the audit
fields (created by, created at) populated.

**Acceptance Scenarios**:

1. **Given** a user holding `course.manage`, **When** they submit a course with all required fields,
   **Then** the course is created with status `draft`, tenant-scoped to their tenant, and `created_by`/
   `created_at` recorded.
2. **Given** a create request missing a required field (title, category, delivery mode, or duration),
   **When** it is submitted, **Then** the request is rejected with a clear error identifying the
   missing field(s) and no record is created.
3. **Given** a create request with an invalid `deliveryMode`, `duration.unit`, or negative `cost`
   value, **When** it is submitted, **Then** it is rejected with a clear validation error. (`status` is
   not a create input at all — every new course starts as `draft`, per Scenario 1; only `PATCH`, User
   Story 3, accepts a `status` value.)
4. **Given** a user holding only `course.view` (no `course.manage`), **When** they attempt to create a
   course, **Then** the request is rejected as forbidden.
5. **Given** a category name that does not yet exist for the tenant, **When** a user holding
   `course.manage` creates a course with that category name, **Then** the category is created
   automatically and the course is associated with it.
6. **Given** an existing category "Leadership", **When** a user holding `course.manage` creates a
   course specifying category "leadership" (different casing), **Then** the course is associated with
   the existing category — no duplicate category is created.

---

### User Story 2 - Browse and find courses in the catalog (Priority: P1)

Anyone holding `course.view` or `course.manage` retrieves the tenant's course catalog, narrows it by
searching on title or filtering by category, delivery mode, or status, and opens a single course by id
to see its full detail.

**Why this priority**: A catalog nobody can read back is not usable by this spec's own future
consumers (Training Requests, TNA, Learning Plans all need to look courses up), and is independently
verifiable as soon as User Story 1 can create data to list.

**Independent Test**: With a tenant that has several courses across different categories, statuses,
and delivery modes, list them, confirm search/filter narrows correctly, and fetch one by id to confirm
its full field set is returned.

**Acceptance Scenarios**:

1. **Given** a tenant with multiple courses, **When** a user holding `course.view` requests the course
   list, **Then** every course belonging to that tenant is returned (archived courses excluded by
   default), each with its full set of catalog fields.
2. **Given** the course list, **When** the user searches by a title substring, **Then** only matching
   courses are returned.
3. **Given** the course list, **When** the user filters by category, delivery mode, or status,
   **Then** only courses matching that filter are returned.
4. **Given** a valid course id belonging to the tenant, **When** a user holding `course.view` requests
   it, **Then** the full course record is returned.
5. **Given** a course id that belongs to a different tenant, **When** any user requests it, **Then**
   the request is rejected as not found (never leaked as "forbidden", which would confirm existence).
6. **Given** a user holding neither `course.view` nor `course.manage`, **When** they call any course
   endpoint, **Then** the request is rejected as forbidden.
7. **Given** a tenant with zero courses, **When** the list is requested, **Then** an empty list is
   returned (not an error).

---

### User Story 3 - Keep course records accurate (Priority: P2)

An L&D admin holding `course.manage` edits an existing course as details change (correcting a
description, updating cost, moving it from `draft` to `active` once it's ready to be used elsewhere in
the platform).

**Why this priority**: Course data drifts after creation (pricing changes, a course graduates from
draft to active); this is materially useful once creation and read access exist, but the catalog is
still usable without it in the short term.

**Independent Test**: As a user holding `course.manage`, update an existing course's status from
`draft` to `active` and its cost, then re-fetch it and confirm both changes persisted along with an
updated `updated_by`/`updated_at`.

**Acceptance Scenarios**:

1. **Given** an existing course, **When** a user holding `course.manage` updates one or more fields,
   **Then** the changes persist and `updated_by`/`updated_at` are refreshed.
2. **Given** an update request with an invalid enum value, **When** submitted, **Then** it is rejected
   with a validation error and no partial update occurs.
3. **Given** a user holding only `course.view`, **When** they attempt to update a course, **Then** the
   request is rejected as forbidden.
4. **Given** an update request targeting a course id in a different tenant, **When** submitted,
   **Then** it is rejected as not found.
5. **Given** an archived course, **When** a user holding `course.manage` updates its status to
   `active` via the general update endpoint, **Then** the course becomes active again — un-archiving is
   just a normal field update, not a separate restore action.

---

### User Story 4 - Retire a course without losing its history (Priority: P2)

An L&D admin holding `course.manage` archives a course that's no longer offered, removing it from the
default active catalog view while preserving the record so anything that already referenced it
(historical requests, reports) still resolves correctly.

**Why this priority**: Once other specs (Training Requests, TNA, Learning Plans) start referencing
courses by id, hard-deleting a course would break those references — archival needs to exist before
that coupling happens, but the catalog is usable without it in the very first cut.

**Independent Test**: As a user holding `course.manage`, archive a course, confirm it no longer appears
in the default course list, and confirm it's still retrievable directly by id.

**Acceptance Scenarios**:

1. **Given** an active or draft course, **When** a user holding `course.manage` archives it, **Then**
   its status becomes `archived` and it is excluded from the default (non-filtered) course list.
2. **Given** an archived course, **When** it is requested directly by id, **Then** it is still
   returned in full.
3. **Given** an archived course, **When** the list is requested with an explicit `status=archived`
   filter, **Then** it is included.
4. **Given** an already-archived course, **When** a user holding `course.manage` archives it again,
   **Then** the request succeeds idempotently (no error, status remains `archived`).
5. **Given** a user holding only `course.view`, **When** they attempt to archive a course, **Then** the
   request is rejected as forbidden.

---

### Edge Cases

- What happens when two courses in the same tenant are created with an identical title? Both are
  allowed — title is not required to be unique (see Assumptions).
- What happens when `cost` is omitted? The course is created with no cost recorded, treated as "not yet
  priced," not as free.
- What happens when a course is requested by id but does not exist at all (any tenant)? Rejected as not
  found, same response shape as a cross-tenant id, so existence of other tenants' data is never
  revealed.
- What happens when list pagination is requested past the last page? An empty result set is returned,
  not an error.
- What happens when search text contains no matches? An empty list is returned, not an error.
- What happens when a request omits authentication entirely? Rejected as unauthorized, before
  permission checks run.
- What happens when a category name is submitted that differs from an existing category only by
  casing or surrounding whitespace (e.g. " Leadership ")? It resolves to the existing category, not a
  new one — matching is case-insensitive and whitespace-trimmed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users holding `course.manage` to create a course with required fields
  title, category, delivery mode, and duration, plus optional fields description, provider/vendor, and
  cost; status MUST default to `draft`.
- **FR-001a**: System MUST seed every tenant with a default set of course categories (Leadership,
  Compliance, Technical, Soft Skills, Onboarding, Other) at provisioning, usable immediately without an
  admin having to create them first.
- **FR-001b**: When a course is created or updated with a category name that does not already exist
  (case-insensitively) in the tenant's category set, System MUST create that category automatically
  and associate the course with it, rather than rejecting the request — no separate category-management
  step is required.
- **FR-001c**: System MUST allow users holding `course.view` or `course.manage` to retrieve the
  tenant's full list of available categories.
- **FR-002**: System MUST allow users holding `course.view` or `course.manage` to retrieve a list of
  their tenant's courses, excluding archived courses by default.
- **FR-003**: System MUST support narrowing the course list by a title search and by filtering on
  category, delivery mode, and status.
- **FR-004**: System MUST allow users holding `course.view` or `course.manage` to retrieve a single
  course by id, scoped to their own tenant.
- **FR-005**: System MUST allow users holding `course.manage` to update an existing course's fields
  (title, description, category, delivery mode, duration, provider/vendor, cost, status), including
  setting status to any of its valid enum values directly — there is no restricted transition graph;
  e.g. moving an `archived` course back to `active` ("un-archiving") is a normal update, not a separate
  action.
- **FR-006**: System MUST allow users holding `course.manage` to archive a course via a dedicated
  archive action (a convenience shorthand for the common "retire this course" case, equivalent to
  updating its status to `archived`), and MUST treat archiving an already-archived course as a no-op
  success rather than an error.
- **FR-007**: System MUST scope every course record and every course operation to the requesting
  user's own tenant, server-side, regardless of any tenant identifier the client supplies; requests
  targeting another tenant's course id MUST be rejected as not found.
- **FR-008**: System MUST reject create, update, and archive requests from users who lack
  `course.manage`, and MUST reject all course endpoints (including read) for users who hold neither
  `course.view` nor `course.manage`.
- **FR-009**: System MUST record `createdBy`/`createdAt` on creation and `updatedBy`/`updatedAt` on
  every subsequent change.
- **FR-010**: System MUST validate delivery mode, status, and duration unit against their fixed,
  platform-wide enum values (delivery mode: `in_person`/`virtual`/`self_paced`/`blended`; status:
  `draft`/`active`/`archived`; duration unit: `minutes`/`hours`/`days`) and reject requests with any
  other value. Category is intentionally NOT validated against a fixed enum — it is validated only for
  tenant-scoping (see FR-001b).
- **FR-011**: System MUST NOT delete a course record on archive — the row and its full history remain
  queryable by id indefinitely, so future features that reference a course by id never encounter a
  broken reference.
- **FR-012**: System MUST NOT include course content/curriculum items (videos, articles, live classes,
  or any other lesson-level structure) in this feature; a course in this spec is metadata only.

### Key Entities *(include if feature involves data)*

- **Course**: A tenant-scoped catalog entry representing an offering that other features (Training
  Requests, Training Needs Analysis, Learning Plans) will later reference by id. Attributes: title,
  description (optional), category (references a Course Category belonging to the same tenant),
  delivery mode (`in_person` / `virtual` / `self_paced` / `blended`), duration (a numeric value plus a
  fixed unit — `minutes` / `hours` / `days` — so both a 30-minute video and a 3-day workshop are
  representable), provider/vendor (optional), cost (optional, single-currency numeric amount), status
  (`draft` / `active` / `archived`), and audit
  fields (created by, created at, updated by, updated at). Belongs to exactly one tenant. Intentionally
  has no relationship to content/lesson data in this spec — that relationship is added by the
  follow-up Course Content spec, which will attach records to a course by its id without requiring a
  change to this entity.
- **Course Category**: A tenant-scoped, tenant-extensible label used to classify courses. Attributes:
  name, and audit fields (created by, created at). Every tenant is seeded with the same default set
  (Leadership, Compliance, Technical, Soft Skills, Onboarding, Other) at provisioning; a user holding
  `course.manage` can add further categories inline while creating or editing a course. Belongs to
  exactly one tenant — never shared or visible across tenants. Names are unique per tenant,
  case-insensitively, so "Leadership" and "leadership" resolve to the same category rather than
  creating a duplicate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user holding `course.manage` can create a valid course record in a single request with
  no retries needed due to unclear validation errors.
- **SC-002**: Searching or filtering a catalog of 500+ courses returns matching results with no
  perceptible delay to the caller.
- **SC-003**: 100% of attempts to read, update, or archive a course belonging to a different tenant are
  rejected, verified by automated test.
- **SC-004**: 0% of archived courses become unretrievable by id — every archive operation preserves the
  full record.
- **SC-005**: 100% of course endpoint calls from users lacking the relevant permission (`course.view`
  for reads, `course.manage` for writes) are rejected, verified by automated test.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change to the isolation model — courses follow the existing
  shared-schema-with-`tenant_id`-scoping pattern already used by departments and training requests;
  every course row carries `tenant_id` and every query is scoped server-side (Principle I).
- **Tenant-configurable vs. fixed platform-wide**: `course.view` and `course.manage` are new granular
  permissions, tenant-assignable per role, following the same pattern as `department.view`/
  `department.manage`. Category is tenant-configurable (Principle II/III): each tenant is seeded with a
  default set, and any `course.manage` holder can extend it inline. Delivery mode and status remain
  fixed platform-wide, since they describe structural/workflow states of the platform itself rather
  than a tenant's own organizational taxonomy — the same distinction already drawn between a
  department's fixed vs. tenant-editable fields.
- **AI-generation review/approval step**: N/A — this spec is manual course-entry only. AI-assisted
  course generation is a distinct future capability (per the product's identity) and will define its
  own review/approval gate before "published" content when it is specified.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec touches no evaluation or ROI data.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: N/A — this spec ships no UI; it is API/data-model only. A future
  "Course Catalog UI" spec will reference the established design system when it builds the screens
  behind the existing disabled "Courses" nav placeholder.
- **Demoable vs. internal**: Internal/infrastructure-only. This spec has no UI surface; it is
  demoable only via direct API calls, not to a non-technical stakeholder. The catalog becomes
  stakeholder-demoable once a follow-up UI spec is built on top of it.

## Assumptions

- Course content (videos, articles, live classes, or any other curriculum/lesson structure) is
  explicitly out of scope for this spec and is deferred to a follow-up "Course Content" spec, expected
  to use a single polymorphic `content_items`-style table (a `type` discriminator plus a flexible
  per-type payload) referencing a course by id, so this spec's schema does not need to anticipate the
  specific shape of that table beyond exposing a stable course id to attach to. Open question flagged
  for that follow-up spec (not resolved here, since no content exists yet to decide against): once
  content items exist, should a course's `duration` become auto-calculated from the sum of its content
  items' durations, remain the manually-entered editorial value defined in this spec, or support both
  (manual value with an auto-computed suggestion)?
- Category is tenant-configurable: each tenant is seeded with the same default set (Leadership,
  Compliance, Technical, Soft Skills, Onboarding, Other) at provisioning, and a `course.manage` holder
  can add new categories inline by naming one that doesn't already exist while creating/editing a
  course — there is no separate category CRUD surface in this spec beyond that inline creation and the
  read-only list (FR-001c). Category names are unique per tenant, case-insensitively. Category deletion/
  archival is out of scope for this spec — once created, a category remains available indefinitely.
- Delivery mode is a fixed enum: `in_person`, `virtual`, `self_paced`, `blended`.
- Duration is captured as a numeric value plus a fixed-enum unit (`minutes` / `hours` / `days`) rather
  than free text, so both very short and very long offerings are representable while staying
  numerically comparable/sortable across the catalog.
- Cost is optional, stored as a plain numeric amount in the tenant's single operating currency; no
  multi-currency support in this spec.
- Course titles are not required to be unique within a tenant.
- This is an API-only feature — no web UI ships as part of this spec. The existing disabled "Courses"
  nav placeholder in the dashboard shell remains disabled until a follow-up UI spec is built against
  this API.
- The course catalog is treated as core LMS functionality available on all plan tiers (Starter/Growth/
  Enterprise), distinct from premium/AI capabilities that are tier-gated elsewhere in the product.
- Archiving is the only removal mechanism in this spec — there is no hard-delete endpoint, so a course
  id referenced elsewhere can never resolve to "gone."
