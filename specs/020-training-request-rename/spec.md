# Feature Specification: Training Request Rename

**Feature Branch**: `020-training-request-rename`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "Rename the \"Training Needs Analysis\" / \"Training Need\" feature to \"Training Request\" throughout the app — user-facing labels, permission keys, and the route path — without changing any underlying behavior, and without breaking permissions for existing tenants. Background: Feature 014 (Training Needs Analysis) implemented a form that any eligible employee or manager can submit to request training. A real Training Needs Analysis is an HR-initiated assessment process, not something triggered ad hoc per employee — so the current feature is actually a Training Request workflow, and naming it \"Training Needs Analysis\" is inaccurate and blocks building the real TNA feature later under its correct name. This rename frees up \"Training Needs Analysis\" / \"tna\" for that future feature."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See accurate "Training Request" labeling everywhere (Priority: P1)

An employee, manager, or HR/L&D admin opens the app and sees the feature consistently called
"Training Request" (not "Training Needs Analysis") in navigation, page titles, forms, and any
notifications they receive about it — matching what the feature actually does today (any
eligible employee or manager can submit one; it is not an HR-initiated assessment).

**Why this priority**: This is the entire point of the change — the current name misleads users
about who can trigger the workflow and blocks the platform from introducing a real, HR-only
Training Needs Analysis feature later under its rightful name.

**Independent Test**: Can be fully tested by navigating every screen and notification that
previously said "Training Needs Analysis" / "Training Need(s)" and confirming it now reads
"Training Request" / "Training Requests", with no functional change to what the screen does.

**Acceptance Scenarios**:

1. **Given** a user with access to the feature, **When** they open the main navigation, **Then**
   they see "Training Request" instead of "Training Needs Analysis".
2. **Given** a user viewing the list, detail, or submission form for this feature, **When** the
   page renders, **Then** every heading, breadcrumb, empty state, and confirmation message reads
   "Training Request(s)" instead of "Training Need(s) Analysis" / "Training Need(s)".
3. **Given** a notification/email is sent for a submission, approval, or status change on this
   feature, **When** the user receives it, **Then** the subject and body use "Training Request"
   terminology.

---

### User Story 2 - Existing tenants keep exactly the access they already have (Priority: P1)

A platform operator ships this rename to production. Every tenant that had previously granted one
or more roles access to view, manage, or approve training requests (under the old permission
names) continues to have that exact same access after the rename, with zero manual re-granting
and zero unexpected access loss or gain.

**Why this priority**: This is a non-negotiable safety constraint on the rename — permission keys
are being renamed as identifiers, not as an access-model change, and any regression here is a
production incident (users locked out of, or newly granted, capability they shouldn't have).

**Independent Test**: Can be fully tested by taking a tenant with roles already granted under the
old permission names, applying the rename, and confirming (via the roles/permissions UI and via
actually attempting the gated actions) that the same users can do exactly the same things as
before — no more, no less.

**Acceptance Scenarios**:

1. **Given** a tenant role was granted the old "view all training needs" permission, **When** the
   rename ships, **Then** that role still grants the equivalent "view all training requests"
   capability with no re-configuration required.
2. **Given** a tenant role was granted the old "approve training needs" permission, **When** the
   rename ships, **Then** that role still grants the equivalent "approve training requests"
   capability with no re-configuration required.
3. **Given** the rename has shipped, **When** an admin opens the roles/permissions management
   screen, **Then** they see the new "Training Request" permission names (not the old names) and
   the same set of roles assigned to them as before the rename.

---

### User Story 3 - Old bookmarked links still work (Priority: P3)

A user who had bookmarked or been sent a direct link to the feature under its old web address
opens that link after the rename has shipped and lands on the correct, equivalent page under the
new address, instead of hitting a broken link.

**Why this priority**: Lower priority than the labeling and permission-safety concerns, but a
broken bookmark or a stale link shared in an email/chat before the rename is a real, if minor,
disruption worth avoiding when the fix is simple.

**Independent Test**: Can be fully tested by visiting the old URL pattern after deployment and
confirming it lands on the corresponding new page with the same underlying record/content.

**Acceptance Scenarios**:

1. **Given** a user has an old bookmarked link to the feature's list page, **When** they open it
   after the rename ships, **Then** they land on the new "Training Request" list page.
2. **Given** a user has an old bookmarked link to a specific record's detail or edit page,
   **When** they open it after the rename ships, **Then** they land on the equivalent new-path
   page for that same record.

---

### Edge Cases

- What happens when a tenant had granted a role a *partial* set of the old permissions (e.g. only
  "approve", not "view" or "manage")? The rename must preserve that exact partial grant — not
  widen or narrow it.
- What happens if the label rename and the permission-key rename are not deployed atomically (a
  window where UI code expects new permission names but the database still has old ones, or vice
  versa)? The feature must not have a deployment ordering that causes a user to be incorrectly
  denied access during rollout.
- How does the system handle an old bookmarked link to a record that has since been deleted or
  the user no longer has access to? It must fail the same way the current feature already fails
  for a missing/inaccessible record today — no new error behavior introduced by the rename.
- What happens to historical audit/log entries or test fixtures that reference the old permission
  key names or old route path? They are historical records of what happened before the rename and
  are not required to be rewritten.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST replace all user-facing occurrences of "Training Needs Analysis" and
  "Training Need"/"Training Needs" with "Training Request"/"Training Requests" respectively,
  across navigation, page titles/headers, form labels, breadcrumbs, empty states, confirmation
  and error copy, and any notification/email templates tied to this feature.
- **FR-002**: System MUST preserve all existing behavior of the feature exactly as-is — who can
  submit, view, edit, and approve entries, the approval workflow, and all validation rules are
  unchanged by this rename.
- **FR-003**: System MUST rename the five permission identifiers that gate this feature (view-all,
  view-department, manage-all, manage-department, approve) to their "Training Request" equivalents,
  changing only the identifier's name, not its meaning or what it gates.
- **FR-004**: System MUST rename the feature's web address (route path) from its old
  "tna"-based path to a "training-request"-based path, including all of its sub-pages (create,
  view, edit).
- **FR-005**: System MUST update the permission identifiers in place for every tenant that already
  has them assigned to one or more roles, such that every existing role-to-permission assignment
  continues to reference the same underlying permission after the rename — no tenant may lose or
  gain access as a side effect of this change.
- **FR-006**: System MUST redirect requests to the old route path (and its sub-pages) to the
  equivalent new route path, preserving any record identifier in the URL, so existing bookmarks
  and shared links continue to resolve correctly.
- **FR-007**: System MUST NOT alter the underlying data records created under the old feature name
  — existing submissions, their statuses, approvals, and history remain fully intact and
  accessible after the rename.
- **FR-008**: System MUST continue to support all existing tenant-configured custom fields
  attached to this feature (via the Custom Fields Framework) unchanged after the rename.

### Key Entities

- **Training Request** (formerly "Training Need"): A single request for training raised by an
  eligible employee or manager, scoped to a department, with a title, priority, and status
  (draft, submitted, approved). Same underlying record as before this rename — only its
  user-facing name and the identifiers referencing it change.
- **Permission**: A named, tenant-assignable capability. Five existing permissions (view-all,
  view-department, manage-all, manage-department, approve) that gate this feature are renamed
  from their old identifiers to new "Training Request"-based identifiers, with role assignments
  to those permissions preserved unchanged across the rename.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of user-facing screens, navigation entries, and notifications that previously
  referenced "Training Needs Analysis" / "Training Need(s)" display "Training Request(s)" after
  the change ships.
- **SC-002**: 0 existing tenant roles lose or gain access to any capability of this feature as a
  result of the rename, verified by comparing each tenant's effective permissions before and after
  the change.
- **SC-003**: 100% of requests to the old route path (list, create, view, edit) successfully land
  users on the equivalent new-path page rather than an error.
- **SC-004**: 0 user-visible functional regressions in submission, editing, approval, or
  visibility behavior for this feature, verified against its existing (pre-rename) test coverage.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change. Training request records remain scoped by
  `tenant_id` exactly as before; this feature only renames labels, permission identifiers, and the
  route path.
- **Tenant-configurable vs. fixed platform-wide**: The permission identifiers themselves (their
  names) are fixed platform-wide, same as before the rename — tenants do not customize permission
  key names. What remains fully tenant-configurable, unchanged by this rename: which roles a
  tenant assigns each of the five permissions to, and any tenant-specific custom fields attached to
  the training request form (per the existing Custom Fields Framework, spec 010).
- **AI-generation review/approval step**: N/A — this feature does not generate AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI
  evaluation data.
- **Downgrade/cancellation behavior**: N/A — this is a label/identifier rename of an existing
  feature, not a new security, budget, or evaluation module.
- **Design system reference**: No new UI screens or components are introduced; existing screens
  are reused as-is with updated copy and route paths, consistent with the established design
  system.
- **Demoable vs. internal**: Demoable — the renamed labels are directly visible to HR/L&D admins,
  managers, and employees in day-to-day use of the feature.

## Assumptions

- Old route requests redirect to the corresponding new route (rather than returning a broken
  link), per the project's default of preferring the more complete/safer option when scope is
  ambiguous.
- The five existing permission identifiers are renamed one-to-one with no change to what each one
  gates (e.g. the old "approve" permission becomes the new "approve" permission, not merged or
  split).
- Internal-only identifiers not visible to end users — file and component names, the backend
  module directory, and the underlying database table name and its constraints/indexes — are
  explicitly out of scope for this change and are not renamed; that is a separate, larger decision
  deferred to a future spec if ever pursued.
- Any notification/email templates that reference "Training Needs Analysis" today are updated as
  part of this change; if no such templates currently exist, this requirement is trivially
  satisfied.
- This spec does not implement the future HR-initiated Training Needs Analysis feature — it only
  renames the existing feature to vacate that name for later use.
