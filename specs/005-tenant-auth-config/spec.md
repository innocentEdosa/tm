# Feature Specification: Tenant Authentication Configuration

**Feature Branch**: `005-tenant-auth-config`

**Created**: 2026-07-04

**Status**: Draft

**Input**: User description: "Build the ability for a tenant's login method to be set during provisioning and edited afterward by the tenant admin, plus a fully working email/password login flow and a polished, config-driven tenant login UI. Depends on Tenant Provisioning Core (Spec 2) and Domain-Based Tenant Routing. Configuration model stores one or more of email/password, Microsoft, Google Workspace, Zoho per tenant, editable by the HR Admin without a code change. Login UI at {tenant}.tm.com must be a design priority, conditionally rendering only configured methods. Email/password must be fully implemented: hashing, tenant-scoped sessions, rate limiting, enumeration protection, and a password reset flow. SSO methods (Microsoft/Google Workspace/Zoho) get configuration and UI presentation only in this spec — actual OAuth integration is deferred to separate per-provider specs. Login must always resolve tenant_id server-side, never from a client-supplied identifier. Out of scope: OAuth integration itself, and MFA."

## Clarifications

### Session 2026-07-04

- Q: Can a tenant have more than one login method enabled at the same time, or exactly one active
  method per tenant? → A: Multiple methods may be enabled simultaneously (e.g., SSO plus
  email/password as a fallback), configurable at provisioning time and editable afterward by the
  tenant's HR Admin.
- Q: How does a user receive their initial password-setup link or a forgotten-password reset link,
  given no outbound email-sending capability exists in this codebase today? → A: Build a real
  email-sending capability now. Two account-creation moments trigger a "set your password" email: (1)
  the initial admin account Spec 2's provisioning creates, and (2) any team member added afterward —
  which means this spec also adds a minimal team-member-invite capability (an HR Admin adds a new
  team member's name, email, and role; the account is created immediately in a
  "password not yet set" state; no separate pending-invitation list, resend, or revoke UI — matching
  the minimal shape every prior stage of this codebase has favored). The specific email-sending
  mechanism/provider is a dependency decision deferred to plan-time, requiring explicit sign-off per
  constitution Principle XIII — not decided in this spec.
- Q: Should a new admin/team member's bootstrap email contain a "set your password" link, or a
  one-time password? → A: A one-time password (OTP). The account is created with the OTP as its
  password (hashed like any other), and the person MUST change it before doing anything else once
  they log in with it — this applies only to the invite/bootstrap flow (US5); forgotten-password
  reset (US4) remains a separate, link-based token flow, unchanged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - HR Admin Configures the Tenant's Login Method (Priority: P1)

As an HR Admin, I go to my organization's settings and see which login method(s) are currently
enabled for my company, and I can turn on or off any of the four supported methods (email/password,
Microsoft, Google Workspace, Zoho) — independently of one another, so more than one can be active at
once (e.g., Microsoft SSO plus email/password as a fallback) — without needing engineering
involvement. The change takes effect immediately for anyone visiting my company's login page.

**Why this priority**: Nothing else in this spec matters if the configuration itself can't be set or
changed — this is the control surface every other story depends on, and it's the concrete expression
of constitution Principle III (tenant-configurable, not one-size-fits-all).

**Independent Test**: Log in as an HR Admin, open the authentication settings screen, toggle a method
on or off, and confirm the change is reflected on the tenant's login page on the next visit — no
deployment, no engineering ticket.

**Acceptance Scenarios**:

1. **Given** a newly provisioned tenant, **When** its authentication settings are viewed for the first
   time, **Then** a sensible default method is already enabled with no manual setup required.
2. **Given** an HR Admin viewing authentication settings, **When** they enable a different method and
   save, **Then** the tenant's login page reflects the new configuration on the very next request.
3. **Given** a tenant with only one method currently enabled, **When** the HR Admin attempts to
   disable it without enabling a replacement, **Then** the system prevents leaving the tenant with
   zero enabled methods.
4. **Given** a tenant with one method already enabled, **When** the HR Admin enables a second method
   without disabling the first, **Then** both remain enabled simultaneously and both appear on the
   login page.

---

### User Story 2 - Employee Logs In With Email and Password (Priority: P1)

As an employee whose company uses email/password login, I go to my company's subdomain, enter my
email and password, and land in a working, authenticated session scoped to my own company — never
anyone else's.

**Why this priority**: This is the one login method that must work completely end-to-end in this
spec (the other three are configuration-and-UI-only) — without it, no tenant using this spec's
default method has a usable product.

**Independent Test**: With email/password enabled for a tenant and a real account on it, submit
correct credentials at that tenant's login page and confirm a session is issued and scoped to that
tenant only.

**Acceptance Scenarios**:

1. **Given** a user with valid credentials at their tenant's subdomain, **When** they submit the
   login form, **Then** they receive a session scoped to that tenant's `tenant_id`, resolved
   server-side from the subdomain — never from anything the login request itself supplied.
2. **Given** a user submits a wrong password, **When** the response is compared to submitting an
   email that doesn't exist at all, **Then** both produce an identical, generic failure response.
3. **Given** repeated failed login attempts against the same account, **When** a threshold is
   reached, **Then** further attempts are rejected for a cool-down period, even with the correct
   password.
4. **Given** a user's session issued at their own tenant's subdomain, **When** it is presented at a
   different tenant's subdomain, **Then** it is rejected — never treated as valid for the wrong
   tenant.

---

### User Story 3 - Login Page Shows Only What's Configured (Priority: P2)

As a visitor to a tenant's login page, I see exactly the login method(s) that tenant has enabled —
nothing more, nothing less — presented clearly even when more than one method is active, so the page
never confuses me with options that don't apply to my company or with visual clutter when several
do.

**Why this priority**: Directly follows from US1's configurability — this is the UX proof that the
configuration actually drives what's shown, not just what's stored, including the harder case of
multiple simultaneously enabled methods.

**Independent Test**: Configure tenants with one enabled method, then with several enabled at once,
visit each login page, and confirm each shows exactly its own configured method(s), clearly presented.

**Acceptance Scenarios**:

1. **Given** a tenant with only email/password enabled, **When** its login page is visited, **Then**
   no Microsoft, Google Workspace, or Zoho option appears.
2. **Given** a tenant with only Microsoft enabled, **When** its login page is visited, **Then** no
   email/password form, Google Workspace, or Zoho option appears.
3. **Given** a tenant with both Microsoft and email/password enabled, **When** its login page is
   visited, **Then** both options are presented clearly, without either crowding out or visually
   subordinating the other in a confusing way.

---

### User Story 4 - User Resets a Forgotten Password (Priority: P2)

As an employee who forgot their password, I request a reset, complete it through a time-limited link,
and log in with my new password — without needing to contact anyone internally.

**Why this priority**: Email/password login isn't genuinely usable without a way to recover from a
forgotten password — sequenced right after the core login flow itself.

**Independent Test**: Request a reset for a real account, complete the reset using the issued token,
and confirm the old password no longer works while the new one does.

**Acceptance Scenarios**:

1. **Given** a user requests a password reset, **When** they use the resulting reset token before it
   expires, **Then** they can set a new password and log in with it.
2. **Given** a reset token has already been used once, **When** it is used again, **Then** it is
   rejected.
3. **Given** someone requests a reset for an email that has no account, **When** the request
   completes, **Then** the response is identical to a successful request for a real account — never
   revealing whether the email exists.

---

### User Story 5 - New Admins and Team Members Get a Working Login Without Manual Setup (Priority: P2)

As an HR Admin, when my company is first provisioned or when I add a new team member afterward, that
person automatically receives an email with a one-time password — nobody has to hand credentials to
anyone in person or over chat — and the very first thing they must do after logging in with it is
choose their own real password, before they can do anything else.

**Why this priority**: Without this, the account Spec 2's provisioning creates (which has no password
at all) and any team member an HR Admin adds are both accounts nobody can actually log into — this is
what makes email/password login (US2) reachable in practice, for more than just a single seeded
account.

**Independent Test**: Provision a new tenant and confirm its initial admin receives a one-time
password by email, logs in with it, and is required to set a real password before reaching anything
else; separately, as that admin, add a new team member and confirm the same flow for them.

**Acceptance Scenarios**:

1. **Given** a tenant is newly provisioned (Spec 2), **When** provisioning completes, **Then** the
   initial admin account receives an email containing a one-time password.
2. **Given** an HR Admin adds a new team member (name, email, role), **When** the account is created,
   **Then** that person immediately receives an email containing a one-time password.
3. **Given** a user logs in with a one-time password, **When** authentication succeeds, **Then** they
   are required to set a new password before being granted access to anything else — no protected
   action is reachable while a one-time password remains active on the account.
4. **Given** a user has completed setting their own password after a one-time-password login,
   **When** they attempt to log in again using the original one-time password, **Then** it is
   rejected — it is single-use and only ever valid for that first, forced-change login.

---

### User Story 6 - HR Admin Enables an SSO Method as Configured-but-Not-Yet-Functional (Priority: P3)

As an HR Admin, I can mark Microsoft, Google Workspace, or Zoho as my company's configured login
method, and see it appear correctly on my login page — understanding that actual sign-in through it
isn't wired up yet.

**Why this priority**: Validates the configuration model and UI for all four methods now, so the
later, per-provider OAuth specs slot in without reworking this spec's design or data model.

**Independent Test**: Enable Microsoft for a tenant, visit its login page, and confirm the option
appears using a clearly non-functional (stubbed) presentation rather than either a broken action or
something indistinguishable from a real, working button.

**Acceptance Scenarios**:

1. **Given** a tenant with Microsoft configured, **When** its login page is visited, **Then** a
   Microsoft sign-in option is visibly present but does not attempt or claim to complete a real login.
2. **Given** an SSO method is configured for a tenant, **When** an HR Admin or visitor interacts with
   it, **Then** the system is clear that full sign-in isn't available yet, rather than failing
   silently or looking broken.

---

### Edge Cases

- A tenant's subdomain resolves to Suspended or Cancelled status — the login page is never reached at
  all in that case; Domain-Based Tenant Routing (Spec 4) already renders a distinct status page before
  this feature's routes are ever consulted, so no additional handling is needed here.
- An HR Admin disables the only currently-enabled method without enabling another first — prevented
  (US1, Acceptance Scenario 3); a tenant must always retain at least one enabled method.
- A session issued while a method was enabled continues to exist after an HR Admin later disables
  that method — the existing session remains valid until it naturally expires; disabling a method
  affects future login attempts, not already-issued sessions.
- Two HR Admins change the configuration at nearly the same time — the system MUST NOT corrupt the
  configuration into an invalid state (e.g., ending with zero methods) as a result of the race; last
  write wins otherwise.
- A password reset token is requested multiple times in quick succession for the same account — only
  the most recently issued token is valid; earlier ones are invalidated.
- An HR Admin adds a team member using an email address already used by another account **at a
  different tenant** — allowed; a person's email is not globally unique across tenants (consistent
  with Spec 2's existing precedent for the initial admin account).
- An HR Admin adds a team member using an email address already in use **at the same tenant** —
  rejected, consistent with the existing per-tenant email uniqueness already enforced on `users`.
- A new account's one-time-password email fails to send (e.g., the email provider is unavailable) —
  the account still exists and the HR Admin can trigger a fresh one-time password rather than the
  whole provisioning or team-member-add operation failing outright.
- A user logs in with a one-time password but abandons the flow before setting a real password —
  the account remains in "must change password" state indefinitely; the same or a freshly issued
  one-time password can be used to resume the flow later.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST store, per tenant, which of exactly four login methods are enabled:
  email/password, Microsoft, Google Workspace, Zoho.
- **FR-002**: System MUST allow more than one login method to be enabled simultaneously for a single
  tenant (e.g., Microsoft plus email/password as a fallback) — enabled methods are independent toggles,
  not a single mutually-exclusive choice.
- **FR-003**: System MUST set a default enabled login method automatically during provisioning (Spec
  2), with no manual configuration step required for a newly provisioned tenant to have a working
  login method from day one.
- **FR-004**: System MUST allow the tenant's HR Admin (or platform equivalent, per Spec 1's role
  model) to view and change which method(s) are enabled for their own tenant, through a tenant-scoped
  settings screen — requiring no code change or deployment to switch between any of the four methods
  (constitution Principle III).
- **FR-005**: The authentication settings screen MUST live at a tenant-subdomain path that does not
  collide with Domain-Based Tenant Routing's root-domain-only path prefixes (`/platform`, `/admin`,
  `/provisioning` — Spec 4 FR-003) — e.g. under `/settings`, never under `/admin`.
- **FR-006**: System MUST prevent an HR Admin from leaving their tenant with zero enabled login
  methods — at least one MUST remain enabled at all times.
- **FR-007**: The tenant-facing login page MUST render only the login method(s) actually enabled for
  the tenant resolved from the current subdomain — never a method that isn't configured, and never a
  method belonging to a different tenant.
- **FR-008**: System MUST fully implement email/password login: verifying submitted credentials
  against a securely hashed password, for the tenant resolved from the current subdomain.
- **FR-009**: System MUST return an identical, generic failure response whether a login attempt fails
  because the email doesn't exist or because the password is wrong — no response difference may
  reveal which case occurred.
- **FR-010**: System MUST rate-limit repeated failed login attempts against the same account, and
  MUST continue rejecting attempts for a cool-down period even once it is subsequently presented with
  the correct password — consistent with the security bar Super Admin Authentication (Spec 3) already
  established (FR-008/FR-009 there).
- **FR-011**: On successful email/password login, System MUST issue a session scoped to the
  `tenant_id` resolved server-side from the current subdomain (Spec 4's verified resolution
  mechanism) — never from a client-supplied tenant identifier of any kind.
- **FR-012**: System MUST reject a session issued for one tenant when it is presented at a different
  tenant's subdomain.
- **FR-013**: System MUST send an email containing a one-time password whenever a new account is
  created that has no password yet — both the initial admin account Spec 2's provisioning creates,
  and any team member added afterward (FR-018-FR-020) — via a real, working outbound email-sending
  capability (the specific provider/mechanism is a plan-time dependency decision requiring explicit
  sign-off per constitution Principle XIII, not decided in this spec).
- **FR-013a**: System MUST require a user who authenticates with a one-time password to set a new
  password immediately afterward, before any other protected action is reachable — a one-time
  password is single-use and MUST be rejected if presented again once the real password has been set.
- **FR-014**: System MUST provide a separate forgotten-password reset flow using a time-limited,
  single-use link/token; using an already-used or expired token MUST be rejected. This is distinct
  from the one-time-password bootstrap mechanism (FR-013/FR-013a) — the two are not the same
  mechanism, since a one-time password is entered through the normal login form while a reset token
  is a link.
- **FR-015**: System MUST return an identical response for a password-reset request regardless of
  whether the submitted email has an account at that tenant — never revealing account existence.
- **FR-016**: System MUST allow an HR Admin to mark Microsoft, Google Workspace, or Zoho as
  "configured" for their tenant without the underlying OAuth integration existing — the login page
  MUST render a visibly non-functional (stubbed) presentation for that method, and MUST NOT attempt
  or imply a completed login through it.
- **FR-017**: System MUST NOT require a code change or deployment to add, remove, or change which of
  the four methods a given tenant has enabled — the mechanism must support this purely through
  configuration data.
- **FR-018**: System MUST allow an HR Admin to add a new team member to their own tenant by submitting
  a name, email, and role (per Spec 1's role model) — creating the account immediately with a
  one-time password (FR-013) as its only valid credential, without a separate pending-invitation
  record, list, resend, or revoke mechanism.
- **FR-019**: A newly added team member's account MUST be usable to log in only with the one-time
  password sent per FR-013, and MUST immediately require setting a real password per FR-013a before
  anything else is reachable.
- **FR-020**: System MUST reject adding a team member whose email is already in use at that same
  tenant, while allowing the same email to exist at a different tenant (consistent with Spec 2's
  existing per-tenant email uniqueness on `users`).

### Key Entities

- **Tenant Authentication Configuration**: Which of the four supported login methods are enabled for
  a given tenant — more than one may be enabled at once, each an independent toggle (FR-002).
  Tenant-scoped; editable only by that tenant's HR Admin (or platform equivalent).
- **Tenant User Credential**: The email/password login information belonging to a `User` (Spec 2) —
  a securely hashed password, never plaintext. Carries a "must change password" state, true from the
  moment a one-time password is issued (FR-013) until the person sets their own password (FR-013a).
  Only exists for users at tenants where email/password is enabled.
- **Tenant User Session**: A server-verified, tenant-scoped login session issued on successful
  authentication, carrying the `tenant_id` it belongs to — analogous in role to the Super Admin
  session (Spec 3), but tied to a tenant rather than platform-global. Not issued for unrestricted use
  while "must change password" is still true (FR-013a) — only enough access to reach the
  set-new-password action.
- **One-Time Password**: The single-use, hashed credential a new admin or team member's account is
  created with (FR-013/FR-018), valid for exactly one login before a real password must be set
  (FR-013a) — distinct from the Password Reset Token below.
- **Password Reset Token**: A time-limited, single-use link/token tied to one user, used to authorize
  a forgotten-password reset without knowing the old password (FR-014) — a separate mechanism from
  the One-Time Password above, not used for initial account bootstrap.
- **Team Member**: Not a new entity — a `User` (Spec 2) added to an existing tenant by its HR Admin
  after provisioning, with a role assignment (Spec 1) and a credential starting with a one-time
  password and "must change password" set to true (FR-018).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An HR Admin can change their tenant's enabled login method and see the change reflected
  on the login page in under 1 minute, with zero engineering involvement.
- **SC-002**: 100% of failed login attempts return an identical response regardless of whether the
  cause was an unknown email or a wrong password.
- **SC-003**: 100% of newly provisioned tenants have at least one working, immediately usable login
  method with zero manual configuration steps.
- **SC-004**: A user can complete a full password-reset-to-successful-login cycle in under 5 minutes.
- **SC-005**: 0% of issued login sessions are ever accepted at a tenant subdomain other than the one
  they were issued for.
- **SC-006**: Visitors can correctly identify, without confusion, which login methods are actually
  usable versus configured-but-not-yet-functional on a tenant's login page (verified via design
  review, since this is a qualitative UX outcome).
- **SC-007**: 100% of newly created accounts (initial provisioning admin and team members added
  afterward) receive a working one-time password by email, and can log in with it, set their own
  real password, and reach the product without any manual, person-to-person credential handoff.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS, consistent with prior specs. Extends the
  existing `users` table (Spec 2) with credential columns rather than creating a competing table —
  exactly what Spec 2's own research anticipated ("Spec 3 is expected to extend this same `users`
  table with auth-specific columns... not create a competing table"). Adds a new tenant-scoped
  session table (RLS-enforced by `tenant_id`, unlike Spec 3's platform-global Super Admin sessions)
  and a new tenant-scoped authentication-configuration entity. This spec is also the concrete
  implementation of the "future auth mechanism" `apps/api/src/plugins/tenant-context.ts` has assumed
  since Spec 1 — it decorates `request.user` from a real, server-verified tenant-user session,
  replacing the development-only header stub for real authenticated tenant-user traffic.
- **Tenant-configurable vs. fixed platform-wide**: Fixed platform-wide — the set of four possible
  login methods themselves (adding a fifth provider is a platform-level code change). Fully
  tenant-configurable — which of the four are enabled for a given tenant, independently, including
  more than one simultaneously (FR-002).
- **AI-generation review/approval step**: N/A — no AI-generated content in this feature.
- **Kirkpatrick L4/L5 data source & formula**: N/A — not applicable to this feature.
- **Downgrade/cancellation behavior**: N/A directly for this feature — Domain-Based Tenant Routing
  (Spec 4) already renders a distinct status page for Suspended/Cancelled tenants before any request
  reaches this feature's login routes.
- **Design system reference**: The login page is explicitly called out as a design priority in this
  spec's own requirements (a first-impression screen, not a default form) — built via the
  UI-UX-Pro-Max skill. If the design system has not yet been formally locked by the time this feature
  is implemented (it was still described as nascent/pending as of the two most recent specs), this
  screen is a strong candidate to be the point at which it gets locked, per Principle V's process —
  flagged here for confirmation, not decided unilaterally.
- **Demoable vs. internal**: **Demoable.** Demo flow: (1) provision a new tenant (Spec 2) and show its
  initial admin's one-time-password email arriving; (2) log in with that one-time password and show
  the forced "set your real password" step before anything else is reachable; (3) as HR Admin, open
  authentication settings, note the default-enabled method, then enable a second method (e.g.,
  Microsoft) alongside it and revisit the login page to see both appear; (4) attempt a login with a
  wrong password and an unknown email side-by-side, showing identical responses; (5) trigger and
  complete a forgotten-password reset (the separate, link-based flow); (6) add a new team member and
  show their one-time-password email arriving, followed by the same forced-change flow; (7) show the
  Microsoft option rendering in a clearly stubbed, non-functional state.

## Assumptions

- The default login method set during provisioning (FR-003) is email/password — it requires no
  external provider setup and lets a newly provisioned tenant's admin log in immediately, consistent
  with Spec 2's existing "working admin login the moment provisioning completes" goal.
- The authentication settings screen (FR-004/FR-005) is the first tenant-admin-facing settings
  surface in this codebase — no general "tenant settings area" exists yet. This spec introduces the
  minimal screen needed for this feature specifically, not a general settings hub; a broader tenant
  settings area, if needed, is left to a future feature to establish.
- This feature also replaces the placeholder tenant landing page Domain-Based Tenant Routing (Spec 4)
  established at `{tenant}.tm.com`'s root path for a valid, active tenant: an unauthenticated visitor
  now sees the login page there, and an authenticated one sees a minimal confirmation landing (not a
  full product dashboard, which remains out of scope) — Spec 4's routing *rules* are unchanged, only
  what that destination page itself renders.
- Marking an SSO method "configured" (US6, FR-016) is understood platform-wide to mean "selected as
  this tenant's intended method," not "functional" — the distinction is visible in the UI itself, not
  hidden in documentation only.
- A tenant's HR Admin is the same role Spec 1/Spec 2 already establish as the tenant's top-level
  administrator; this spec does not introduce a new administrative role.
- The team-member-add capability (US5, FR-018-FR-020) is deliberately minimal: immediate account
  creation, no pending-invitation record, list, resend, or revoke mechanism — matching the minimal
  shape every prior stage of this codebase has favored (e.g., Spec 2's own single-admin-only scope
  boundary). A fuller invitation-management experience, if ever needed, is left to a future feature.
- Building a real outbound email-sending capability (FR-013) is a genuine new external-service
  dependency for this codebase (no email-sending capability, package, or provider account exists
  today) — the specific provider/mechanism (e.g., a transactional email API vs. an SMTP relay) is
  intentionally left undecided here and flagged for explicit sign-off at plan time, per constitution
  Principle XIII.
- This spec also amends Spec 2's provisioning flow to generate a one-time password and send it once
  the initial admin account is created (FR-013) — the account-creation logic itself
  (`provisionTenant`) is unchanged; only a new side effect is added after it succeeds.
- Multi-factor authentication and the actual OAuth integration/callback handling for Microsoft, Google
  Workspace, and Zoho are explicitly out of scope, left to future, separate specs (one per OAuth
  provider, per this spec's own Out of Scope statement).
- Custom domains per tenant remain out of scope, per Domain-Based Tenant Routing's own Out of Scope
  statement — this feature's login page is reached only via `{tenant}.tm.com`.
