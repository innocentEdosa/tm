# Feature Specification: Super Admin Add Member

**Feature Branch**: `021-super-admin-add-member`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "Extend the Super Admin Tenant Console (Spec 020) with the ability to add a new member to a tenant directly from the console's Members tab — an \"Add Member\" button opening a small form (full name, email, role, department) inside a Modal, consistent with the existing design system. This is NOT a new mechanism: it reuses the exact validation order, OTP/invite flow, and email content already used by the tenant-side `POST /tenant-auth/team` (Specs 012/013) — role must exist in that tenant (`roleExists`-equivalent check, re-implemented with an explicit `tenant_id` filter per Spec 020's own research.md §1 lesson, since `request.superAdminDb` is never implicitly scoped to one tenant), department if given must be active in that tenant, email must be unique within that tenant (409 on conflict), a one-time password is generated and hashed, `mustChangePassword` is set true, and the same branded invite email (`buildMemberInviteEmail`/`sendMemberInviteEmail`, unchanged) is sent — unlike Spec 020's password-reset action, this DOES send an email, since a brand-new member has no existing access to restore, only a first login to receive. The new route runs through `request.superAdminDb`, exercising the `super_admin_full_access` policies Spec 020 already added on `users` and `user_roles` (both already permit INSERT via their existing `WITH CHECK` clause — confirm whether any additional policy is actually needed before assuming none is). `users.invited_by` stays NULL for a member created this way, since a Super Admin has no tenant-scoped `users.id` to attribute it to — this is a deliberate, visible difference from a tenant-admin-invited member in the existing Team Directory's \"Invited By\" column, not an oversight to fix. Every add-member action is logged to Spec 020's existing `member_action_log` table with a new `\"member_added\"` action value, for the same accountability reason as its `\"password_reset\"` action. Out of scope: custom field values on creation (the console's Members tab already excludes custom fields per Spec 020's own Assumptions — this stays consistent), bulk/CSV import, resending or revoking an invite (doesn't exist anywhere in this codebase today, per Spec 012's own Non-goals), and editing an existing member's role, department, or details (Spec 020's FR-014 restriction against editing stays fully intact — this feature adds creation only, never edit)."

## Clarifications

### Session 2026-07-16

- Q: Should adding a member work for a tenant in any status (Active, Trial, Archived, Suspended,
  Pending-Deletion), or only Active/Trial tenants? → A: Fully available regardless of tenant status
  — consistent with Spec 020's own precedent (viewing and password-reset both already work
  regardless of status).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a Member to a Tenant Without Leaving the Console (Priority: P1)

As a Super Admin, from a tenant's Members tab inside the console, I can add a new member by entering
their name, email, role, and (optionally) department — the member receives the same branded invite
email every other new member gets, with a one-time password to set up their own real password on
first login — so I can help a tenant onboard someone (e.g. at their request, or while setting up a
new tenant) without needing that tenant's own admin to do it.

**Why this priority**: This is the entire capability requested — a single, self-contained addition to
the existing console (Spec 020) that reuses an already-proven mechanism end to end.

**Independent Test**: From the console's Members tab, select "Add Member," fill in a new person's
name, email, and role, submit, and confirm the member appears in the directory immediately, an invite
email is sent to them, and they can log in with the one-time password and are prompted to set a real
one — independent of any other console capability.

**Acceptance Scenarios**:

1. **Given** a tenant open in the console with at least one existing role, **When** a Super Admin
   fills in a new member's full name, email, and an existing role (department optional) and submits,
   **Then** the member is created, appears in the Members tab immediately, and receives the same
   branded invite email with a one-time password that every other new member receives.
2. **Given** the Add Member form, **When** a Super Admin submits an email address already used by
   another member of the *same* tenant, **Then** the system rejects the submission with a clear
   "email already in use" message and creates no new row.
3. **Given** the Add Member form, **When** a Super Admin submits a role that does not belong to that
   tenant, or a department that is not active in that tenant, **Then** the system rejects the
   submission with a clear message and creates no new row.
4. **Given** a member added through this console, **When** their entry is later viewed in that
   tenant's own Team Directory, **Then** it shows no "Invited By" name (distinct from a member invited
   by one of that tenant's own admins) — this is expected, not an error.
5. **Given** a member was successfully added through this console, **When** platform records are later
   checked, **Then** who added them, to which tenant, and when, is recoverable — even without a
   dedicated audit-log screen.
6. **Given** a non-Super-Admin caller, **When** that caller attempts to call the add-member route
   directly, **Then** the system rejects the request the same way it rejects any other
   Super-Admin-only route.
7. **Given** a tenant in any status (Active, Trial, Archived, Suspended, or Pending-Deletion),
   **When** a Super Admin adds a member to it, **Then** the member is created the same way
   regardless of the tenant's status.

---

### Edge Cases

- What happens if the branded invite email fails to send (mail provider unavailable)? The member
  account is still created and usable — this matches the existing tenant-side behavior, where email
  delivery failure is logged server-side but never rolled back or surfaced as a submission failure.
- What happens if a Super Admin submits the Add Member form twice in quick succession (e.g. a slow
  response, a double-click)? The second attempt MUST be rejected as a duplicate-email conflict (User
  Story 1, Acceptance Scenario 2) rather than creating two members or silently overwriting one.
- What happens if the tenant has zero existing roles yet? The Add Member form has no valid role to
  offer — the system MUST make this state clear (e.g. "This tenant has no roles yet") rather than
  allowing a submission with no role or failing with a raw error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The console's Members tab MUST provide an "Add Member" action that opens a form
  collecting full name, email, role, and (optionally) department.
- **FR-002**: The system MUST reject a submission missing full name, email, or role, before
  attempting any write.
- **FR-003**: The system MUST reject a role that does not belong to the tenant being added to, and a
  department that is not active in that tenant — before attempting any write — mirroring the existing
  tenant-side validation order exactly.
- **FR-004**: The system MUST reject an email address already used by another member of the *same*
  tenant, leaving that tenant's existing member unaffected; the same email at a *different* tenant
  MUST be unaffected and allowed.
- **FR-005**: Upon successful validation, the system MUST create the new member with a
  system-generated one-time password and MUST require them to set their own password at first login
  — the same "must change password" state every other newly-created member starts in.
- **FR-006**: The system MUST send the new member the same branded invite email (with the one-time
  password) that every other newly-created member receives — this action DOES send an email, unlike
  the console's existing password-reset action.
- **FR-007**: A member created through this console MUST NOT show an inviting colleague in that
  tenant's own Team Directory "Invited By" column — this is the expected, visible signal that a Super
  Admin (not a tenant admin) added them.
- **FR-008**: The system MUST record every add-member action performed through this console (at
  minimum: which Super Admin, which tenant, which new member, and when), even though no dedicated
  audit-log screen is in scope for this spec.
- **FR-009**: All console pages and this route's underlying API MUST be restricted to Super Admin
  sessions, using the same guard applied to every other Super-Admin-only route today; any other
  caller MUST be rejected.
- **FR-010**: Adding a member MUST work for a tenant in any status (Active, Trial, Archived,
  Suspended, or Pending-Deletion) — tenant status MUST NOT gate this action, consistent with Spec
  020's FR-013 precedent for viewing and password-reset.
- **FR-011**: This feature MUST NOT introduce any way to edit an existing member's role, department,
  or details from within the console — that restriction (Spec 020 FR-014) remains fully intact; this
  feature adds creation only.
- **FR-012**: This feature MUST NOT collect or store tenant-configured custom field values at
  creation time — consistent with the console's Members tab already excluding custom fields.

### Key Entities *(include if feature involves data)*

- **Member**: The existing tenant-scoped user record (Specs 002/012/013); this feature adds one more
  way to create a row in it — the record itself gains no new fields.
- **Member Action Log Entry**: Existing platform-level audit record introduced by Spec 020; this
  feature adds a new recorded action value (`"member_added"`) alongside its existing
  `"password_reset"` value — no new table or column.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can add a new member to any tenant, from that tenant's console, in under
  one minute.
- **SC-002**: 100% of members added through this console receive the same invite email, with the
  same one-time-password mechanics, as a member added through any tenant's own admin screen — no
  onboarding experience gap between the two paths.
- **SC-003**: 100% of add-member actions performed through this console are traceable afterward to a
  specific Super Admin, tenant, and new member.
- **SC-004**: Attempting to add a member with an email already used in that tenant never creates a
  duplicate or silently overwrites the existing member — it is rejected every time.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS — no change to the isolation model
  established by Spec 020. This feature performs one additional cross-tenant write (an `INSERT` into
  `users` and `user_roles`, explicitly scoped to the target tenant's id supplied by the route, never
  inferred from ambient connection state — Spec 020 research.md §1). No new RLS policy is needed: the
  `super_admin_full_access` policies Spec 020 already added on `users` and `user_roles` already permit
  `INSERT` via their existing `WITH CHECK (app.is_super_admin = true)` clause (confirmed against the
  shipped migrations — 0062, 0063).
- **Tenant-configurable vs. fixed platform-wide**: N/A directly — this feature creates a row using a
  tenant's already-configured roles/departments; it introduces no new configurable entity.
- **AI-generation review/approval step**: N/A — no AI-generated content is involved.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI data.
- **Downgrade/cancellation behavior**: Directly implicated and resolved — per FR-010, adding a member
  works identically regardless of a tenant's status (Active, Trial, Archived, Suspended, or
  Pending-Deletion); status changes elsewhere (Spec 015) do not gate this feature.
- **Design system reference**: This feature MUST reuse the established, locked design system and the
  existing Modal/form component patterns already used elsewhere in the console (Spec 020) and in the
  tenant-side Add Member form (Spec 013) — no new visual language is introduced.
- **Demoable vs. internal**: Demoable — a Super Admin can show a stakeholder "here's how I onboard a
  new person into any tenant without needing that tenant's own admin available."

## Assumptions

- This feature reuses the exact validation order, one-time-password mechanics, and invite email
  content already shipped for the tenant-side `POST /tenant-auth/team` (Specs 012/013) — no new
  onboarding mechanism is introduced.
- `users.invited_by` is left `NULL` for a member added this way, since a Super Admin has no
  tenant-scoped `users.id` to attribute it to; the existing Team Directory UI already renders a blank/
  "—" value for a null inviter, so no UI change is needed there.
- No custom field values are collected at creation time through this console, consistent with the
  console's Members tab already excluding custom fields (Spec 020 Assumptions).
- This feature depends on: Spec 020 (Super Admin Tenant Console — the console this extends, and the
  `member_action_log` table/RLS policies it introduced), and Specs 012/013 (the existing member
  creation mechanism — validation, OTP, invite email — being reused unchanged).
- No new top-level navigation destination is introduced; this stays an action within the existing
  console's Members tab.
