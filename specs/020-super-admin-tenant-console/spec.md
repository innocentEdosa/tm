# Feature Specification: Super Admin Tenant Console

**Feature Branch**: `020-super-admin-tenant-console`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "Build a Super Admin \"Enter Tenant\" capability from the existing Tenant Management list (Spec 015): a new per-tenant row action (e.g. \"Manage\") that takes the Super Admin into a read-focused, tenant-scoped console for that one tenant — company details (reusing the 015 edit view), its department hierarchy (Spec 009, read-only here), its roles/permission catalog (Spec 011, read-only here), and its member directory (Spec 012/013, read-only here except for the password action below) — all rendered inside the Super Admin's own platform dashboard shell (Spec 007), not by switching the browser into the tenant's own subdomain or UI. This is NOT tenant-user impersonation: the Super Admin never assumes a member's session or identity, stays on their own `tm_super_admin_session` the whole time, and every read/write is attributed to the Super Admin in any audit trail — consistent with why Spec 004 added a narrow `app.subdomain_lookup`-style RLS allowance flag instead of a `BYPASSRLS` role; this spec needs an equivalent `app.is_super_admin`-gated SELECT policy (and a narrow UPDATE allowance for the one write below) on the relevant tenant-scoped tables, keyed by an explicit tenant_id parameter rather than the connection's own tenant context. All API calls from this console must go through the existing same-origin `/platform-api` rewrite proxy (Spec 003's cookie mechanism), never a direct cross-origin fetch, since the tenant data being viewed lives on tenant subdomains that are a genuinely different origin. The one write capability in scope: from a member's row in this console, a Super Admin can directly set/reset that member's password without the existing email/token reset flow (Spec 018/016) — need to decide whether the Super Admin sets a specific new password or the system generates one, whether the member is forced to change it on next login, and that the member's existing active sessions are invalidated immediately (mirroring the immediate-session-termination precedent from Spec 015's archive/delete). Every password-set action must be logged (who, which tenant, which member, when) even without a dedicated audit-log UI. Out of scope: true \"view as member\" session impersonation, bulk password resets, editing members/roles/departments from this console (that stays in each tenant's own UI), self-serve SSO, and a dedicated audit-log screen."

## Clarifications

### Session 2026-07-16

- Q: How does a Super Admin set a member's password through this console, and what happens at that
  member's next login? → A: The system generates the new password automatically (the Super Admin
  never types one). The generated password is shown to the Super Admin once, at reset time. The
  member is NOT forced to change it at next login — it remains valid until it is reset again.
- Q: Is this console (and specifically the password-reset action) usable for a tenant that is
  Archived, Suspended, or in a Pending-Deletion grace period (per Spec 015's status model), or
  restricted to Active/Trial tenants only? → A: Fully available regardless of tenant status —
  viewing and the password-reset action both work the same for a tenant in any status (Active,
  Trial, Archived, Suspended, Pending-Deletion).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a Tenant's Full Picture Without Leaving the Platform Console (Priority: P1)

As a Super Admin, from the Tenants list I can open a dedicated console for one tenant showing its
company details, department hierarchy, roles/permission catalog, and member directory — all while
staying on my own Super Admin session — so I can understand and support a tenant's setup without
asking them to screen-share their own admin views or handing me their credentials.

**Why this priority**: Every other capability in this spec (resetting a member's password) requires
first being able to reach that tenant's data. Without this, a Super Admin has no way to see a tenant's
departments, roles, or members except by asking the tenant directly.

**Independent Test**: From the Tenants list (Spec 015), select a tenant's "Manage" action and confirm
its company details, department hierarchy, role/permission catalog, and member directory all render
correctly, read-only, independent of whether the password-reset action has been built yet.

**Acceptance Scenarios**:

1. **Given** a tenant with departments, roles, and members, **When** a Super Admin selects "Manage"
   from the Tenants list, **Then** a console opens inside the Super Admin's own platform dashboard
   shell showing that tenant's company details, department hierarchy, role/permission catalog, and
   member directory.
2. **Given** the console is open, **When** the Super Admin's browser session/URL is inspected,
   **Then** they remain on the platform's own origin and `tm_super_admin_session` — never redirected
   to the tenant's subdomain and never issued a tenant-user session.
3. **Given** a non-Super-Admin caller (tenant-scoped user, or no session at all), **When** that caller
   attempts to open this console or its underlying API routes directly, **Then** the system rejects
   the request the same way it rejects any other Super-Admin-only route today.
4. **Given** the console is open, **When** the Super Admin attempts to edit a department, role, or
   member from within it, **Then** no edit capability is offered — those remain reachable only from
   within the tenant's own UI.

---

### User Story 2 - Unblock a Locked-Out Member Without Email (Priority: P1)

As a Super Admin, from a tenant's member directory inside the console, I can directly set or reset a
specific member's password without triggering that tenant's email/token-based reset flow, so I can
unblock a member immediately (e.g. no working inbox, urgent access needed) without waiting on email
delivery.

**Why this priority**: This is the other half of the explicit capability requested and the only write
action in scope — sequenced immediately after User Story 1 since it depends on first being able to
reach a specific member's row.

**Independent Test**: From the console's member directory, select a member, trigger the password
action, and confirm the member's password changes with no email sent and their existing active
session(s) invalidated immediately.

**Acceptance Scenarios**:

1. **Given** a member of a tenant open in the console, **When** a Super Admin performs the
   password-reset action on that member, **Then** the system generates a new password automatically,
   displays it to the Super Admin once, and updates the member's password — with no email or reset
   link sent.
2. **Given** a password reset via the console, **When** the member next logs in, **Then** they use
   the generated password directly — they are not forced to change it before continuing.
3. **Given** a password reset via the console, **When** checked immediately afterward, **Then** that
   member's existing active session(s) are invalidated, requiring them to sign in again with the new
   credential.
4. **Given** a password reset via the console, **When** platform records are later checked, **Then**
   who performed the reset, on which tenant, on which member, and when, is recoverable — even without
   a dedicated audit-log screen.
5. **Given** a tenant in any status (Active, Trial, Archived, Suspended, or Pending-Deletion),
   **When** a Super Admin performs a password reset for one of its members, **Then** the reset
   succeeds the same way regardless of the tenant's status.
6. **Given** a non-Super-Admin caller, **When** that caller attempts to call the password-reset route
   directly, **Then** the system rejects the request the same way it rejects any other
   Super-Admin-only route.

---

### Edge Cases

- What happens when a Super Admin opens the console for a tenant that has zero departments, zero
  custom roles, or zero members? Each section MUST render its own empty state rather than erroring or
  appearing broken.
- What happens if a tenant is archived, suspended, or deleted (soft-deleted, pending purge) while its
  console is open in another browser tab? The console MUST reflect the tenant's current status; per
  FR-013, the password-reset action remains available regardless of status (e.g. to prepare a
  member's credential ahead of the tenant being un-archived).
- What happens if a Super Admin navigates directly to a console URL for a tenant ID that does not
  exist (mistyped, purged after its grace period)? The system MUST show a clear "tenant not found"
  state rather than a raw error.
- What happens if the same member is targeted by two password-reset attempts in quick succession (two
  Super Admin tabs, or a retry after a slow response)? The second attempt MUST still leave the member
  in a single, consistent, known-password state — not a race that silently drops one of the resets.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a per-tenant entry point (e.g. a "Manage" row action) on the
  existing Tenants list (Spec 015) that opens a tenant-scoped console for that single tenant.
- **FR-002**: The console MUST render inside the Super Admin's own platform dashboard shell (Spec
  007) — the system MUST NOT navigate the browser to the tenant's own subdomain or issue a tenant-user
  session to reach it.
- **FR-003**: The console MUST display the selected tenant's company details, using the same data
  already surfaced in Spec 015's edit view.
- **FR-004**: The console MUST display the selected tenant's department hierarchy (Spec 009),
  read-only.
- **FR-005**: The console MUST display the selected tenant's roles and permission catalog (Spec 011),
  read-only.
- **FR-006**: The console MUST display the selected tenant's member directory (Spec 012/013),
  read-only, with the sole exception of the password-reset action in FR-008.
- **FR-007**: All console pages and their underlying API routes MUST be restricted to Super Admin
  sessions, using the same guard applied to other Super-Admin-only routes today; any other caller
  MUST be rejected.
- **FR-008**: From a member's row inside the console, a Super Admin MUST be able to set or reset that
  member's password directly, without initiating the tenant's existing email/token-based reset flow.
- **FR-009**: The system MUST generate the member's new password automatically (the Super Admin does
  not type a specific password) and MUST display the generated password to the Super Admin once, at
  the moment of reset. The member is NOT required to change this password at their next login — it
  remains valid until reset again.
- **FR-010**: Upon a password reset performed through this console, the system MUST invalidate the
  affected member's existing active session(s) immediately.
- **FR-011**: The system MUST record every password-reset action performed through this console (at
  minimum: which Super Admin, which tenant, which member, and when), even though no dedicated
  audit-log screen is in scope for this spec.
- **FR-012**: All data requests the console makes to the API MUST route through the platform's
  existing same-origin request path rather than a direct cross-origin request, preserving the
  established Super Admin session-cookie behavior.
- **FR-013**: The console — including its password-reset action — MUST remain fully available for a
  tenant in any status (Active, Trial, Archived, Suspended, or Pending-Deletion); tenant status MUST
  NOT gate either viewing the console or performing a password reset.
- **FR-014**: The console MUST NOT provide the ability to edit members, roles, or departments from
  within it — those actions remain exclusively available from within each tenant's own UI.
- **FR-015**: The system MUST NOT allow a Super Admin to assume a member's session or identity (no
  "view as member" / impersonation session swap) — every action inside the console is attributed to
  the Super Admin's own identity.

### Key Entities *(include if feature involves data)*

- **Tenant**: The existing tenant record (Spec 002/015); this feature adds a read view of its full
  detail from a platform-level context.
- **Department**: Existing per-tenant org unit (Spec 009); surfaced read-only in this console.
- **Role / Permission Template**: Existing per-tenant role catalog (Spec 011); surfaced read-only in
  this console.
- **Member**: Existing tenant-scoped user record (Spec 012/013); surfaced read-only in this console
  except for the password field, which this feature can update directly.
- **Password Reset Action Record**: A minimal log entry this feature introduces — Super Admin actor,
  target tenant, target member, and timestamp — recorded for every reset even without a dedicated
  audit-log UI. The generated password itself is displayed to the Super Admin once at reset time and
  is not persisted in this log.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can reach any tenant's full detail (company, departments, roles, members)
  within two selections starting from the Tenants list.
- **SC-002**: A Super Admin can unblock a locked-out member (reset their password and view the
  generated credential) in under one minute from opening the console, with no email round-trip
  required, regardless of that member's tenant's status.
- **SC-003**: 100% of password resets performed through this console are traceable afterward to a
  specific Super Admin, tenant, and member.
- **SC-004**: 100% of members whose password is reset through this console are unable to continue
  using a session that was active before the reset — every prior session stops working immediately.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS. This feature performs cross-tenant reads
  (and one narrow, targeted write) from a platform-level context. Consistent with the precedent set
  when Spec 004 needed pre-tenant-context subdomain lookups, this extends the existing RLS policies
  with an explicit, narrow Super-Admin-scoped allowance keyed to a specific tenant identifier supplied
  by the request — never a blanket bypass-RLS role, and never by assuming the connection's own tenant
  context.
- **Tenant-configurable vs. fixed platform-wide**: N/A directly — this feature introduces no new
  configurable entity. It surfaces each tenant's already-configured departments, roles, and members
  read-only; configurability of those entities themselves is governed by their own specs (009, 011,
  012/013).
- **AI-generation review/approval step**: N/A — no AI-generated content is involved.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI data.
- **Downgrade/cancellation behavior**: Directly implicated and resolved — per FR-013, this console
  and its password-reset action remain fully available regardless of a tenant's status (Active,
  Trial, Archived, Suspended, or Pending-Deletion); status changes elsewhere (Spec 015) do not gate
  this feature.
- **Design system reference**: This feature MUST reuse the established, locked design system (Spec
  008) and the existing component patterns from Specs 007, 009, 011, 012/013, and 015 — no new visual
  language is introduced.
- **Demoable vs. internal**: Demoable — a Super Admin can show a stakeholder "here's how I look up any
  tenant's setup and unblock a locked-out employee without emailing them a reset link."

## Assumptions

- The console shows the same core fields already defined by each source spec (Spec 009 departments,
  Spec 011 roles, Spec 012 member core fields — Name, Email, Role, Department, Account status);
  tenant-configured custom fields (Custom Fields Framework, Spec 010) are not surfaced in this
  read-only view unless explicitly requested later.
- No new Super-Admin identity or credential concept is introduced; the existing Super Admin session
  (Spec 003) is the actor recorded for every read and the one write in scope.
- This feature depends on: Spec 003 (Super Admin authentication and its RLS-allowance-flag precedent),
  Spec 004 (the same-origin cookie proxy that this console's API calls must also use), Spec 007
  (platform dashboard shell), Spec 009 (departments), Spec 011 (roles), Spec 012/013 (member
  directory), Spec 015 (Tenants list, the sole entry point into this console), and Spec 016/018 (the
  existing email/token password-reset mechanics this feature deliberately bypasses for this one
  action).
- No new top-level navigation destination is introduced; the console is reached only via a row action
  on the existing Tenants list, not as its own standalone sidebar item.
