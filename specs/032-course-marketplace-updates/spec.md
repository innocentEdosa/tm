# Feature Specification: Course Marketplace Updates

**Feature Branch**: `032-course-marketplace-updates`

**Created**: 2026-08-04

**Status**: Draft

**Input**: User description: "Course Marketplace Updates — allow a Super Admin to keep editing a platform course (details, curriculum, files) after one or more tenants have already selected/cloned it, instead of the current hard freeze, and give tenants a way to review and opt into those updates. Replace the freeze established in specs/029-course-marketplace with a versioned update-and-notify flow: (1) remove the hard frozen-after-first-clone restriction on platform course editing; (2) any edit to file-backed content after clones exist must upload to a new storage object rather than overwriting in place, so tenants who haven't accepted an update keep seeing their originally-cloned file untouched; (3) track a simple version on the platform course sufficient to show tenants an update-available indicator and apply an update as a discrete action; (4) email every tenant user holding course.manage on a tenant with an active clone of the course when a Super Admin publishes an edit, reusing existing mailer infrastructure; (5) tenants can apply an update (overwriting their cloned course/module/content-item metadata and curriculum with the current platform version, without touching or resetting existing learner_progress rows) or dismiss it and keep their current version; (6) reuse the existing clone machinery adapted to overwrite in place. Out of scope: re-mapping learner_progress across structural changes, a diff/changelog UI, partial/selective updates, and any change to the free/paid selection or payment-reconciliation flow from 029."

## Clarifications

### Session 2026-08-04

- Q: Cloned tenant courses share the same R2 file object as the platform original rather than a copy. If a Super Admin edits/replaces a course image or attachment after tenants have cloned it, should that write a new storage object (so tenants who haven't opted in keep seeing their old file until they accept the update), or overwrite the shared object in place? → A: New storage object per edit. Each edit uploads to a new storage key; a tenant's clone keeps pointing at whatever key it was cloned/updated to until that tenant explicitly applies a newer update.
- Q: When a tenant applies an update, what happens to that tenant's existing learners and their progress on the course? → A: Keep progress, update content. Course metadata/modules/content-item rows on the tenant's clone are updated to match the platform version; existing learner progress records are left untouched. If the course's structure changed (items added, removed, or reordered), progress records may now reference stale or renumbered content items — this is an accepted, explicitly flagged risk, not something this feature re-maps or fixes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Super Admin edits a platform course that tenants have already cloned (Priority: P1)

A Super Admin needs to fix or improve a platform course — correct a typo, replace an outdated module,
swap the course image, update a SCORM package — even after one or more tenants have already selected
it. Today this is blocked entirely once any tenant has cloned the course.

**Why this priority**: This is the core reversal this spec exists to deliver. Without it, nothing else
in this spec (notification, tenant update flow) has anything to act on.

**Independent Test**: As a Super Admin, edit a platform course's title and swap its course image after
a tenant has already cloned it, and confirm both edits save successfully with no "frozen" rejection.

**Acceptance Scenarios**:

1. **Given** a platform course with one or more tenants that have a fulfilled clone of it, **When** a
   Super Admin edits its title, description, category, delivery mode, duration, or cost, **Then** the
   change saves successfully.
2. **Given** the same platform course, **When** a Super Admin adds, edits, reorders, or removes a
   module or content item, **Then** the change saves successfully.
3. **Given** a platform content item with an attached file (course image, lesson attachment, or SCORM
   package) that at least one tenant has already cloned, **When** a Super Admin replaces that file,
   **Then** the new file is stored as a new object and the platform content item now references it,
   without modifying or deleting the object any existing tenant clone currently points to.
4. **Given** a platform course with zero tenant clones, **When** a Super Admin edits it, **Then** it
   behaves exactly as it does today (editable, no version-tracking overhead beyond what this spec
   requires for courses that do have clones).

---

### User Story 2 - Tenant is notified an update is available (Priority: P1)

When a Super Admin publishes a change to a platform course, every tenant that already has a clone of it
should find out, without having to notice on their own.

**Why this priority**: Editing being unblocked (User Story 1) is only useful to tenants if they learn an
update exists — otherwise their clone silently falls behind the platform source with no way to know.

**Independent Test**: As a Super Admin, edit a platform course that one tenant has cloned, and confirm
every user on that tenant holding `course.manage` receives an email about the available update, and that
an "update available" indicator appears on the course wherever that tenant manages it.

**Acceptance Scenarios**:

1. **Given** a platform course with a fulfilled clone in Tenant A, **When** a Super Admin publishes an
   edit to that platform course, **Then** every user in Tenant A holding `course.manage` receives an
   email notifying them an update is available for that course.
2. **Given** the same edit, **When** a user in Tenant A holding `course.manage` views their cloned
   course, **Then** they see an indicator that an update is available.
3. **Given** a platform course with clones in both Tenant A and Tenant B, **When** a Super Admin
   publishes an edit, **Then** both tenants are notified and both see the update-available indicator —
   notification is per clone, not limited to one tenant.
4. **Given** a platform course with zero clones, **When** a Super Admin edits it, **Then** no email is
   sent and no indicator is shown anywhere (there is no tenant clone to notify).
5. **Given** a tenant that already sees the update-available indicator for a course, **When** the Super
   Admin edits that same platform course again before the tenant has applied or dismissed the prior
   update, **Then** the tenant is not re-notified for every intermediate edit — one outstanding
   "update available" state per tenant clone, reflecting the latest published version.

---

### User Story 3 - Tenant applies an available update (Priority: P1)

A tenant user holding `course.manage` reviews the update-available indicator and chooses to bring their
cloned course up to date with the current platform version.

**Why this priority**: This is the tenant's half of the value this spec delivers — without it, tenants
can only ever find out about updates, never actually receive them.

**Independent Test**: As a tenant user holding `course.manage`, apply an available update on a cloned
course, and confirm the course's title, curriculum, and files now match the current platform version,
while any existing learner progress on that course is untouched.

**Acceptance Scenarios**:

1. **Given** a tenant's cloned course with an update available, **When** the tenant user applies the
   update, **Then** the cloned course's metadata, modules, and content items are updated to match the
   current platform version, and the update-available indicator clears.
2. **Given** a course with learners who have existing progress records, **When** the tenant applies an
   update to it, **Then** those learner progress records are left untouched — not deleted, reset, or
   modified by the update.
3. **Given** a platform content item's file was replaced since the tenant's clone was made, **When** the
   tenant applies the update, **Then** the tenant's cloned content item now references the new file, and
   the tenant's learners see the updated file going forward.
4. **Given** a tenant user holding only `course.view` (not `course.manage`), **When** they attempt to
   apply an update, **Then** the request is rejected as forbidden.
5. **Given** a tenant applies an update, **When** the Super Admin's platform course is inspected
   afterward, **Then** it is unchanged — applying an update never writes back to the platform source.

---

### User Story 4 - Tenant dismisses an available update (Priority: P2)

A tenant user holding `course.manage` decides the current version of their cloned course is fine as-is
and chooses to keep it rather than apply the available update.

**Why this priority**: Completes the "opt into" framing from the feature request — without an explicit
dismiss action, tenants are implicitly pressured to always apply, which isn't the intent.

**Independent Test**: As a tenant user holding `course.manage`, dismiss an available update and confirm
the cloned course is completely unchanged, and the indicator clears until the platform course changes
again.

**Acceptance Scenarios**:

1. **Given** a tenant's cloned course with an update available, **When** the tenant user dismisses it,
   **Then** the cloned course's metadata, curriculum, and files remain exactly as they were, and the
   update-available indicator clears.
2. **Given** a dismissed update, **When** the Super Admin publishes a further edit to that platform
   course, **Then** the tenant is notified again and the update-available indicator reappears — dismissal
   only applies to the version it was shown for, not permanently.
3. **Given** a tenant user holding only `course.view`, **When** they attempt to dismiss an update,
   **Then** the request is rejected as forbidden.

---

### Edge Cases

- What happens when a Super Admin edits a platform course several times before a tenant reacts to the
  first notification? The tenant sees a single outstanding "update available" state reflecting the
  latest published version and, if they apply it, receives everything published so far in one action —
  not one update per edit.
- What happens when a platform course's curriculum structure changes (content items added, removed, or
  reordered) between the tenant's clone and the version they apply? The update still applies; any
  learner progress tied to a content item that no longer exists in the new structure, or missing for a
  newly added one, is an accepted, explicitly flagged limitation of this feature, not remediated here.
- What happens when a Super Admin edits an `archived` platform course that still has fulfilled clones?
  Treated the same as editing any other platform course with clones — the edit is allowed, and affected
  tenants are notified; archived only affects visibility to *new* tenant browsing/selection, not editing
  or updates to existing clones.
- What happens when the notification email fails to send? The Super Admin's edit still saves and the
  in-app "update available" indicator still appears — email delivery is a best-effort notification, not
  a precondition for the update becoming available.
- What happens when a tenant applies an update and the platform course is edited again by the Super
  Admin before the tenant's apply action completes? The tenant's apply reflects whichever version was
  current at the moment it ran; if the Super Admin's newer edit was not yet included, the tenant simply
  sees a new update-available indicator afterward, same as any other subsequent edit.
- What happens to a tenant's selection that is pending or rejected (never reached a fulfilled clone)?
  Not applicable — there is no cloned course to notify about or update; this feature only concerns
  tenants with an existing fulfilled clone.
- What happens when a caller without a valid session (Super Admin editing, or tenant applying/dismissing)
  attempts any action in this spec? Rejected as unauthorized, same as every other action in the
  marketplace feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow an authenticated Super Admin to edit a platform course's metadata,
  curriculum (modules and content items), and attached files at any time, regardless of how many
  tenants have already cloned it — the prior restriction rejecting edits once any tenant clone exists is
  removed.
- **FR-002**: System MUST, when a Super Admin replaces a file attached to a platform content item that
  at least one tenant has already cloned, store the new file as a new object rather than overwriting the
  object any existing clone references, and update the platform content item to reference the new
  object; existing tenant clones MUST continue referencing whatever object they were last cloned or
  updated to until they explicitly apply a newer update.
- **FR-003**: System MUST track, for each platform course, a version marker that increments whenever a
  Super Admin publishes a change to that course's metadata, curriculum, or attached files.
- **FR-004**: System MUST track, for each tenant's fulfilled clone of a platform course, which platform
  course version that clone currently reflects.
- **FR-005**: System MUST determine an "update available" state for a tenant's clone by comparing the
  clone's recorded version against the platform course's current version, and MUST surface this state to
  tenant users holding `course.manage` wherever they manage that cloned course.
- **FR-006**: System MUST, when a Super Admin publishes a change to a platform course that increments its
  version, send an email notification to every user holding `course.manage` in every tenant that has a
  fulfilled clone of that course, informing them an update is available. System MUST NOT send a separate
  notification for every intermediate edit if a tenant has not yet acted on a prior notification — at
  most one outstanding "update available" notification state per tenant clone per unapplied version.
- **FR-007**: System MUST allow a tenant user holding `course.manage` to apply an available update to
  their cloned course, which updates that clone's course/module/content-item metadata and curriculum
  structure to match the platform course's current version, updates references to any newer file
  objects, and advances the clone's recorded version to match; existing `learner_progress` records for
  that course MUST NOT be deleted, reset, or otherwise modified by applying an update.
- **FR-008**: System MUST allow a tenant user holding `course.manage` to dismiss an available update
  without changing their cloned course in any way; the clone's recorded version does not change, but the
  update-available state clears until a subsequent platform course edit produces a newer version.
- **FR-009**: System MUST reject any attempt to apply or dismiss an update, by a tenant user who lacks
  `course.manage`, and MUST reject any platform course edit by a caller without a valid Super Admin
  session — same permission model as the rest of the marketplace feature.
- **FR-010**: System MUST NOT modify the platform course, its curriculum, or its files as a result of a
  tenant applying or dismissing an update — updates flow one direction only, from platform source to
  tenant clone.
- **FR-011**: System MUST NOT re-map, migrate, or otherwise adjust existing `learner_progress` records
  when a course's structure changes between the version a tenant was on and the version they apply —
  this is explicitly out of scope for this feature.
- **FR-012**: System MUST NOT introduce a diff/changelog view of what changed between versions, partial
  or per-module update application, or any change to the free/paid selection and payment-reconciliation
  flow established in specs/029-course-marketplace.

### Key Entities *(include if feature involves data)*

- **Platform Course**: Existing entity from specs/029-course-marketplace. No longer becomes immutable
  once a tenant clone exists. Gains a version marker that increments on any published change to its own
  fields, curriculum, or attached files.
- **Platform Course Content Item Attachment**: Existing file-attachment concept from specs/025/029. An
  edit to a platform content item's file after clones exist produces a new stored object and a new
  attachment reference on the platform content item, rather than replacing the object in place.
- **Marketplace Selection**: Existing entity from specs/029-course-marketplace, tracking one tenant's
  relationship to one platform course. Gains a record of which platform course version the tenant's
  fulfilled clone currently reflects, and whether an update notification is currently outstanding for
  that clone (so repeat edits before the tenant reacts don't generate repeat emails, per FR-006).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can publish an edit to a platform course that already has tenant clones with
  zero manual unlock steps and zero rejected-as-frozen errors.
- **SC-002**: Every tenant user holding `course.manage` on a tenant with a clone of an edited platform
  course receives an update-available notification without needing to check the marketplace proactively.
- **SC-003**: A tenant user holding `course.manage` can bring their cloned course fully up to date with
  the platform source in a single action, with no follow-up steps required per module or content item.
- **SC-004**: 100% of existing learner progress on a course survives a tenant applying an update to it —
  no progress record is lost or reset as a direct result of applying an update.
- **SC-005**: A tenant that dismisses an update sees no change whatsoever to their course's content,
  curriculum, or files as a result of that dismissal.
- **SC-006**: A tenant is never notified more than once for the same outstanding platform course version
  they haven't yet acted on.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change. Platform course/module/content-item tables remain
  tenant-id-less platform data; `marketplace_selections` remains tenant-scoped exactly as established in
  specs/029-course-marketplace. This feature adds fields/behavior to existing entities, not a new
  isolation model.
- **Tenant-configurable vs. fixed platform-wide**: The platform course's content itself remains fixed
  platform-wide, authored solely by Super Admin, exactly as in specs/029. What is tenant-configurable is
  *timing*: each tenant independently decides whether and when to apply a given update to their own
  clone. No tenant can alter what the Super Admin publishes.
- **AI-generation review/approval step**: N/A — this feature does not generate content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI evaluation.
- **Downgrade/cancellation behavior**: N/A — not a billing, budget, or security module.
- **Design system reference**: The tenant-facing "update available" indicator and apply/dismiss action,
  and the removal of the Super Admin's "frozen" messaging, are new UI surfaces on top of the existing
  course-management and course-marketplace screens (specs/023, 028, 029) and MUST follow the
  already-established design system rather than introducing new patterns.
- **Demoable vs. internal**: Demoable — a Super Admin editing a previously-frozen course, a tenant
  receiving a notification email, and a tenant applying or dismissing an update are all
  stakeholder-visible outcomes.

## Assumptions

- "Registered tenant admins," as used in the originating request, means tenant users holding the
  existing `course.manage` permission — the same permission that already gates browsing, selecting, and
  managing courses in specs/023 and 029. This feature does not introduce a new "tenant admin" role
  distinct from that permission.
- A single monotonically increasing version marker per platform course (rather than per-module or
  per-content-item versioning, and rather than a full change-diff/changelog) is sufficient to drive the
  update-available indicator and the notification-dedupe behavior in FR-006.
- Applying an update is all-or-nothing for the whole course — there is no partial or per-module
  acceptance, consistent with the feature request and explicitly out of scope per FR-012.
- The existing mailer infrastructure and template conventions (specs/016-email-api-mailer,
  019-email-template-redesign) are reused for the update-available notification; this feature does not
  introduce a new email-sending mechanism.
- Applying an update overwrites a tenant's cloned course/module/content-item rows to match the platform
  version's current structure and content; it does not delete and recreate the tenant's course as a new
  entity, so identifiers referenced elsewhere (e.g. course assignments, training requests pointing at the
  tenant's course id) remain stable across an update.
- The existing clone machinery from specs/029-course-marketplace (`clonePlatformCourseIntoTenant`) is
  extended/reused for applying updates rather than replaced, per the originating request.
