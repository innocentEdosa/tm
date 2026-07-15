# Feature Specification: Tenant Management

**Feature Branch**: `015-tenant-management`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Build a Tenant Management view for Super Admins — a list of every tenant provisioned on the platform, with the ability to edit a tenant's company details, archive it, downgrade it, and delete it. Restricted entirely to Super Admin sessions (the same requireSuperAdminSession guard used by tenant provisioning, Super Admin Authentication spec's super_admins mechanism) — no tenant-scoped user (HR Admin, Manager, Employee) can ever reach this view or its underlying API routes. Replace the platform shell's 'Provision Tenant' nav entry with 'Tenants', pointing at a new list-first page: the Super Admin lands on a list of every tenant across the platform (company name, subdomain, status, primary contact, created date), and reaches the existing 'Add Tenant' company-details form (currently at /provisioning/new, built in Tenant Provisioning Core) via an 'Add Tenant' button/link on that list page, rather than the nav item going straight to the form. Per-tenant row actions: Edit — update the tenant's company details (name, industry, primary contact info); a subdomain edit must re-run the same uniqueness and reserved-word validation used at initial provisioning (FR-002/FR-016 of Tenant Provisioning Core). Archive — a reversible, non-destructive way to stop a tenant from being actively used without deleting its data; distinct from Delete. Downgrade — step a tenant's status down (e.g. Active back to Trial). No plan/tier or billing concept exists yet on the tenants table, so this operates purely on the existing status field (trial/active/suspended/cancelled), not a billing tier. Delete — permanently remove a tenant; needs to specify whether this is a hard delete (tenant row and all tenant-scoped data) or a soft/recoverable delete, consistent with the constitution's tenant-isolation and data-integrity principles. All list and action endpoints are platform-connection-context routes (no tenant_id in scope) guarded by requireSuperAdminSession, following the same pattern as the existing provisioning route. Out of scope: plan-tier/billing data, self-serve tenant signup, bulk/multi-select actions, and a dedicated audit-log UI (though each action should be logged)."

## Clarifications

### Session 2026-07-15

- Q: Should "Downgrade" introduce a plan/tier concept, or operate purely on the existing tenant status field? → A: Status transition only (e.g. Active → Trial) — no plan/tier field is introduced by this spec.
- Q: Is Delete a hard delete (immediate, permanent removal) or a soft/recoverable delete? → A: Soft delete with a grace period — a deleted tenant enters a "pending deletion" state, is immediately removed from the Tenants list and made unreachable, and is recoverable during a defined grace period before a separate purge process permanently removes its data.
- Q: Should an in-progress session for a tenant's users be terminated immediately when that tenant is archived or deleted, or only denied on their next request/login? → A: Immediate termination — live sessions for that tenant are actively invalidated the moment archive or delete takes effect, not left to expire on their own. (Downgrade does not block access at all, per FR-010, so this does not apply to downgrade.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See Every Tenant on the Platform at a Glance (Priority: P1)

As a Super Admin, when I open the "Tenants" section of the platform console, I land on a list of every
tenant ever provisioned — company name, subdomain, status, primary contact, and when it was created —
so I have a single place to find and act on any tenant without knowing its subdomain or ID ahead of
time.

**Why this priority**: Every other capability in this spec (edit, archive, downgrade, delete) requires
first finding the tenant to act on. Without this list, a Super Admin has no way to reach an existing
tenant at all today — the current nav only offers a form to create new ones.

**Independent Test**: Log in as a Super Admin, open the "Tenants" nav entry, and confirm every
previously provisioned tenant appears in the list with its company name, subdomain, status, primary
contact, and created date — independent of whether any edit/archive/downgrade/delete action has been
built yet.

**Acceptance Scenarios**:

1. **Given** at least one tenant has been provisioned, **When** a Super Admin opens the "Tenants" nav
   entry, **Then** they see a list showing every provisioned tenant's company name, subdomain, status,
   primary contact, and created date.
2. **Given** the Tenants list is open, **When** the Super Admin selects "Add Tenant", **Then** they
   reach the existing company-details provisioning form (Tenant Provisioning Core), and on successful
   submission the new tenant appears in the list without a page reload losing their place.
3. **Given** a non-Super-Admin session (tenant-scoped user, or no session at all), **When** that caller
   attempts to open the Tenants list or its underlying API route, **Then** the system rejects the
   request the same way it rejects any other Super-Admin-only route today.

---

### User Story 2 - Edit a Tenant's Company Details (Priority: P1)

As a Super Admin, I can open any tenant from the list and update its company name, industry, or primary
contact info, and — if I change its subdomain — the system validates the new subdomain exactly as it
would at initial provisioning, so tenant records stay accurate after onboarding without engineering
involvement.

**Why this priority**: Company details captured at provisioning go stale (rebrands, changed contacts,
corrected typos). This is the most common, lowest-risk action a Super Admin needs after provisioning,
so it ships alongside the list itself.

**Independent Test**: From the Tenants list, open an existing tenant, change its primary contact email,
save, and confirm the new value appears both in the edit view and back in the list — independent of
archive/downgrade/delete.

**Acceptance Scenarios**:

1. **Given** an existing tenant, **When** a Super Admin edits its name, industry, or primary contact
   info and saves, **Then** the change persists and is reflected immediately in the Tenants list.
2. **Given** an existing tenant, **When** a Super Admin edits its subdomain to one already in use by
   another tenant, or to a platform-reserved word, **Then** the system rejects the change with a clear
   message and the tenant's subdomain remains unchanged — using the same validation as initial
   provisioning (Tenant Provisioning Core FR-002/FR-016).
3. **Given** an existing tenant, **When** a Super Admin edits its subdomain to a value that is unique
   and not reserved, **Then** the change is saved and the tenant becomes reachable at its new subdomain.

---

### User Story 3 - Archive a Tenant Without Losing Its Data (Priority: P2)

As a Super Admin, I can archive a tenant to immediately stop it from being actively used, while keeping
all of its data intact and being able to reverse the archive later — so I have a safe, reversible way to
pause a tenant (e.g. a lapsed prospect, a paused contract) without the finality of deleting it.

**Why this priority**: A reversible pause is a materially lower-risk operation than deletion and is
needed as soon as any tenant exists that should stop being active — sequenced right after list + edit,
ahead of the two higher-risk actions (downgrade, delete).

**Independent Test**: From the Tenants list, archive an existing tenant, confirm its status reflects
"Archived" in the list and that tenant's own users can no longer sign in, then reverse the archive and
confirm the tenant becomes usable again with all of its prior data (departments, users, records)
unchanged.

**Acceptance Scenarios**:

1. **Given** an active tenant, **When** a Super Admin archives it, **Then** the tenant's status updates
   to reflect it is archived, any of that tenant's users currently signed in are immediately signed out,
   and no tenant-scoped user can sign in or access tenant data afterward.
2. **Given** an archived tenant, **When** a Super Admin reverses the archive, **Then** the tenant
   returns to its usable state with every department, user, and record it had before archiving fully
   intact.
3. **Given** an already-archived tenant, **When** a Super Admin attempts to archive it again, **Then**
   the system treats this as a no-op and does not error or duplicate any state change.

---

### User Story 4 - Downgrade a Tenant's Status (Priority: P2)

As a Super Admin, I can step a tenant's status down (for example, from Active back to Trial) directly
from the Tenants list, so I can reflect a change in the tenant's relationship with the platform without
needing to archive or delete it outright.

**Why this priority**: Less urgent than list/edit, and lower-risk than delete, but still a distinct,
regularly-needed lifecycle action once tenants exist in states beyond Trial.

**Independent Test**: From the Tenants list, downgrade an Active tenant to Trial, and confirm its status
in the list reflects the change while its data and users remain fully intact and it remains reachable —
independent of archive/delete.

**Acceptance Scenarios**:

1. **Given** a tenant in Active status, **When** a Super Admin downgrades it, **Then** its status
   updates to Trial, its data and users remain intact, and the tenant remains reachable (not archived).
2. **Given** a tenant already at the lowest reachable status, **When** a Super Admin attempts to
   downgrade it further, **Then** the system disables or rejects the action rather than silently doing
   nothing or erroring unclearly.

---

### User Story 5 - Permanently Delete a Tenant (Priority: P3)

As a Super Admin, I can delete a tenant that should never have existed or must be removed (e.g. a test
tenant, a legal/compliance removal request), with an explicit confirmation step that makes clear what
happens before it happens, and a recovery window in case the deletion was a mistake.

**Why this priority**: The highest-risk, least-frequently-needed action — sequenced last, and always
available as a distinct, harder-to-trigger action from Archive.

**Independent Test**: From the Tenants list, delete a tenant, confirm the explicit confirmation step
before the deletion is finalized, confirm the tenant no longer appears in the list and its users are
immediately signed out, then confirm it can be recovered within the grace period and is permanently
removed only after that window closes.

**Acceptance Scenarios**:

1. **Given** an existing tenant, **When** a Super Admin selects Delete, **Then** the system requires an
   explicit confirmation step naming the tenant before the deletion is finalized.
2. **Given** the confirmation step is completed, **When** the deletion is finalized, **Then** the tenant
   enters a pending-deletion state, immediately no longer appears in the Tenants list or is reachable via
   its subdomain, and any of its users currently signed in are immediately signed out.
3. **Given** a Super Admin opens the delete confirmation, **When** they cancel instead of confirming,
   **Then** the tenant is left completely unchanged.
4. **Given** a tenant in the pending-deletion state, **When** a Super Admin recovers it within the grace
   period, **Then** the tenant returns to its prior state with all data intact and becomes reachable
   again.
5. **Given** a tenant in the pending-deletion state, **When** the grace period elapses without recovery,
   **Then** the tenant record and all of its tenant-scoped data are permanently and irreversibly removed.

---

### Edge Cases

- What happens if a Super Admin edits a tenant's subdomain to the value it already has (no actual
  change)? The system MUST accept this as a no-op save, not a validation failure.
- What happens if two Super Admins act on the same tenant at nearly the same time (e.g. one archives
  while another downgrades)? The system MUST apply both as sequential, server-validated state changes —
  never silently drop one action or leave the tenant in an inconsistent status.
- What happens if a Super Admin attempts to downgrade or edit an already-archived tenant? The system
  MUST require the tenant be reactivated first, rather than allowing edits or downgrades to silently
  apply to an archived tenant.
- What happens to a signed-in tenant user's active session at the moment their tenant is archived or
  deleted? The system MUST immediately terminate any of that tenant's in-progress sessions the moment
  archive or delete takes effect, rather than leaving them to expire on their own (see Clarifications).
  Downgrade does not block access at all (FR-010), so no session termination applies to it.
- What happens to a tenant's data (departments, users, TNA records, custom fields, etc.) when it is
  deleted? The system MUST treat this as a soft delete: the tenant enters a pending-deletion state,
  immediately becomes unreachable and invisible in the list, and its data remains intact and
  recoverable until a defined grace period elapses, after which it is permanently and irreversibly
  removed (see Clarifications).
- What happens if a Super Admin attempts to recover a tenant from the pending-deletion state after its
  grace period has already elapsed and the purge has run? The system MUST treat this the same as
  attempting to recover any tenant that was never deleted — there is nothing left to recover, and the
  system MUST report this clearly rather than silently failing.
- What happens if a Super Admin attempts to delete a tenant that is currently Active with real user
  activity, as opposed to an idle Trial tenant? The system MUST apply the same confirmation and outcome
  regardless of tenant status — deletion is not gated by how "live" the tenant currently is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a Tenants list view showing every tenant provisioned on the platform,
  displaying at minimum: company name, subdomain, status, primary contact, and created date.
- **FR-002**: System MUST restrict the Tenants list view and every action described in this spec (edit,
  archive, reactivate, downgrade, delete) to authenticated Super Admin sessions only, using the same
  session-guarding mechanism already enforced on the existing tenant-provisioning route (Super Admin
  Authentication spec). Any request from a tenant-scoped session (HR Admin, Manager, Employee) or an
  unauthenticated caller MUST be rejected.
- **FR-003**: System MUST replace the platform shell's "Provision Tenant" navigation entry with
  "Tenants", pointing to the list view in FR-001, rather than directly to the tenant-creation form.
- **FR-004**: System MUST provide an "Add Tenant" action on the Tenants list view that navigates to the
  existing tenant-creation form (Tenant Provisioning Core), and MUST reflect a newly provisioned tenant
  in the list without requiring the Super Admin to manually refresh or re-navigate.
- **FR-005**: System MUST allow a Super Admin to edit an existing tenant's company name, industry, and
  primary contact name/email/phone, persisting the change and reflecting it in the Tenants list
  immediately.
- **FR-006**: System MUST allow a Super Admin to edit an existing tenant's subdomain, applying the same
  uniqueness and reserved-word validation used at initial provisioning (Tenant Provisioning Core
  FR-002, FR-016), and MUST reject the edit with a clear message — leaving the subdomain unchanged — if
  either check fails.
- **FR-007**: System MUST allow a Super Admin to archive an active tenant, which MUST immediately
  terminate any of that tenant's currently active user sessions and prevent its users from signing in
  or accessing tenant data afterward, while leaving all of that tenant's existing data (departments,
  users, records) fully intact.
- **FR-008**: System MUST allow a Super Admin to reverse an archive on a previously archived tenant,
  restoring it to a usable state with all of its prior data intact and unchanged.
- **FR-009**: System MUST treat archiving an already-archived tenant as a no-op — it MUST NOT error or
  produce a duplicate state change.
- **FR-010**: System MUST allow a Super Admin to downgrade a tenant's status one step down (e.g. Active
  to Trial), applying only to the tenant's status field — this spec introduces no plan-tier or billing
  concept, per the Clarifications above.
- **FR-011**: System MUST prevent downgrading a tenant that is already at the lowest reachable status,
  disabling or clearly rejecting the action rather than erroring ambiguously or silently doing nothing.
- **FR-012**: System MUST prevent editing or downgrading a tenant that is currently archived; that
  tenant must first be reactivated (FR-008) before either action is available again.
- **FR-013**: System MUST allow a Super Admin to delete a tenant, requiring an explicit confirmation
  step that names the specific tenant being deleted before the deletion is finalized.
- **FR-014**: System MUST leave a tenant completely unchanged if a Super Admin begins but cancels the
  delete confirmation step.
- **FR-015**: System MUST, once a tenant deletion is finalized, immediately remove it from the Tenants
  list, make it unreachable via its subdomain, terminate any of its currently active user sessions, and
  place it in a pending-deletion state rather than deleting its data outright.
- **FR-015a**: System MUST allow a Super Admin to recover a tenant from the pending-deletion state at
  any point before its grace period elapses, restoring it to its prior state with all data fully intact
  and reachable again.
- **FR-015b**: System MUST permanently and irreversibly remove a tenant's record and all of its
  tenant-scoped data once its pending-deletion grace period elapses without recovery.
- **FR-016**: System MUST log every edit, archive, reactivate, downgrade, delete, and delete-recovery
  action taken through this feature, including which Super Admin performed it and when — even though a
  dedicated audit-log UI is out of scope for this spec.
- **FR-017**: System MUST apply archive, reactivate, downgrade, delete, and delete-recovery as atomic,
  server-validated state changes — concurrent actions from different Super Admin sessions against the
  same tenant MUST each be applied consistently in sequence, never silently dropped or left
  half-applied.

### Key Entities

- **Tenant**: The existing platform-level tenant record (Tenant Provisioning Core). This spec extends
  who can change its status and company-detail fields after initial provisioning, and introduces two
  new lifecycle states distinct from the existing Trial/Active/Suspended/Cancelled values: Archived
  (reversible, blocks access, retains data indefinitely until reactivated) and Pending Deletion
  (reversible only within a defined grace period, after which the tenant and its data are permanently
  removed).
- **Tenant Action Log Entry**: A record of a management action taken against a tenant through this
  feature — which action (edit/archive/reactivate/downgrade/delete), which tenant, which Super Admin,
  and when. Platform-level, not tenant-scoped. No dedicated UI in this spec (FR-016), but the
  underlying record MUST exist to support one later.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can find any previously provisioned tenant from the Tenants list in under 10
  seconds, without needing to know its subdomain or ID ahead of time.
- **SC-002**: 100% of attempts to reach the Tenants list or its underlying actions from a non-Super-Admin
  session are rejected, verified across all tenant-scoped role types and unauthenticated requests.
- **SC-003**: A Super Admin can edit a tenant's company details and see the change reflected in the list
  in under 1 minute, with zero engineering involvement.
- **SC-004**: 100% of archived tenants have their prior data (departments, users, records) fully intact
  and unchanged when reactivated, verified across at least two independently archived-and-reactivated
  test tenants.
- **SC-005**: 100% of subdomain edits that collide with an existing tenant or a reserved word are
  rejected before being saved, with zero tenants ever reachable at a duplicate or reserved subdomain.
- **SC-006**: 100% of finalized tenant deletions require and record an explicit confirmation step naming
  the tenant, with zero deletions completing without it.
- **SC-007**: 100% of a tenant's currently signed-in users are unable to access tenant data within one
  request of that tenant being archived or deleted, verified as immediate rather than delayed until
  natural session expiry.
- **SC-008**: 100% of tenants recovered from the pending-deletion state within their grace period are
  restored with all prior data fully intact, verified across at least one test recovery.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change to the isolation model. Shared schema w/ RLS, consistent
  with Tenant Provisioning Core and Super Admin Authentication — this feature only adds Super-Admin-only
  read/write access to the existing platform-level `Tenant` record and its status, plus a new
  platform-level (not tenant-scoped) action-log record. No tenant-scoped table's RLS policy changes.
- **Tenant-configurable vs. fixed platform-wide**: N/A for departments, roles, permissions, forms, or
  approval flows — this feature touches only the platform-level Tenant record itself (company details,
  status), not any tenant-configurable structure. Which fields are editable (name, industry, primary
  contact, subdomain) and which lifecycle actions exist (edit, archive, downgrade, delete) are fixed
  platform-wide capabilities available only to Super Admins, not tenant-configurable.
- **AI-generation review/approval step**: N/A — this feature does not generate AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI evaluation.
- **Downgrade/cancellation behavior**: This spec directly implements downgrade, archive, and delete as
  three distinct lifecycle transitions (User Stories 3, 4, 5): downgrading steps status down with no
  data loss and no access change (FR-010); archiving immediately terminates active sessions and blocks
  tenant user access while preserving all tenant data indefinitely until reactivated (FR-007, FR-008);
  deletion immediately terminates active sessions and blocks access, then permanently and irreversibly
  removes the tenant and its data only after an unrecovered grace period elapses (FR-015, FR-015a,
  FR-015b).
- **Design system reference**: This feature includes new UI screens (Tenants list, per-tenant edit form,
  archive/downgrade/delete confirmation interactions). It MUST be built against the design system
  established by the Desktop Shell Visual Language spec and used by the existing platform shell
  (`(platform-shell)` layout, `AppShell` component) — no ad hoc styling introduced for this feature.
- **Demoable vs. internal**: Stakeholder-demoable. Opening the Tenants list, editing a tenant, archiving
  and reactivating one, downgrading another, and deleting a test tenant with its confirmation step is a
  coherent, end-to-end demo a non-technical stakeholder can watch and follow.

## Assumptions

- "Platform admins" in the originating request refers to the platform's Super Admin role as already
  defined by the Super Admin Authentication spec (`super_admins` table, `requireSuperAdminSession`
  guard) — there is currently only one platform-operator role in the system, not a tiered set of
  "platform admin" permission levels. If a more granular platform-operator permission model is needed
  later, that is a separate spec.
- "Downgrade" operates purely on the tenant's existing status field (e.g. Active → Trial) per the
  Clarifications above; no plan-tier or billing entity is introduced by this spec, consistent with
  Tenant Provisioning Core FR-012, which explicitly deferred plan-tier data to a future spec.
- Archiving is treated as functionally equivalent to blocking a tenant's active use while retaining its
  data — implemented as a new, reversible state distinct from Trial/Active/Suspended/Cancelled, rather
  than reusing "Cancelled" (which this spec treats as a separate, not-yet-implemented lifecycle
  transition outside this feature's scope).
- The "Edit" and "Update" actions named in the originating request are treated as the same capability
  (FR-005/FR-006) — editing a tenant's company details and subdomain — rather than two distinct actions,
  since no separate meaning for "Update" was specified.
- The pending-deletion grace period's exact length (e.g. 30 days) is a planning-level detail, not fixed
  by this spec — this spec only requires that a defined, non-zero grace period exists and that recovery
  and permanent purge behavior around it work as described (FR-015, FR-015a, FR-015b). **Flagged for
  stakeholder sign-off** at planning time.
- This spec assumes the Tenant Provisioning Core and Super Admin Authentication specs have already
  shipped (both are implemented in this codebase today) — this is a hard dependency, not a soft one,
  since this feature reuses their validation logic (FR-006) and session-guarding mechanism (FR-002)
  directly rather than reimplementing either.
