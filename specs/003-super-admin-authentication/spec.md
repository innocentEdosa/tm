# Feature Specification: Super Admin Authentication

**Feature Branch**: `003-super-admin-authentication`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Build authentication for Super Admins — platform/vendor-level operators who manage TM across all tenants, architecturally separate from tenant-scoped users (HR Admin, Manager, Employee). A dedicated `super_admins` table with no tenant_id column. RLS policies must not bypass RLS via a BYPASSRLS role — instead extend each relevant policy with an explicit Super Admin allowance clause driven by a server-set `app.is_super_admin` session flag. A dedicated login route, separate from tenant-user login. A seed script to bootstrap the first Super Admin, safe to re-run. Session handling must reject tenant-scoped tokens on Super Admin routes and vice versa. Out of scope: full Super Admin Console, SSO, multi-admin invite flow."

## Clarifications

### Session 2026-07-02

- Q: Does this spec supersede Spec 1's platform-level Super Admin mechanism (the `roles.tenant_id IS NULL` row plus the `tm_platform_reader` `BYPASSRLS` role)? → A: Yes, confirmed — this spec's `super_admins` + `app.is_super_admin` mechanism supersedes it. Migrating Spec 1's/Spec 2's existing call sites to the new mechanism remains follow-up implementation work, not required by this spec itself.
- Q: Login routing isolation — fixed platform-level path vs. dedicated admin subdomain? → A: Fixed platform-level path (e.g. `/platform/login`) within the existing Next.js app — no subdomain-based routing infrastructure exists anywhere in this codebase yet, and building it purely for this spec would be disproportionate; path-scoped cookies plus the mandatory session-type-rejection requirement (FR-007) give adequate isolation for this milestone.
- Q: Session model — server-side revocable session vs. stateless signed token (JWT)? → A: Server-side revocable session — a session record referenced by an opaque token in an httpOnly, Secure cookie. Chosen for immediate revocability given the explicit risk of a compromised Super Admin account; a stateless JWT would need its own server-side blocklist to be revocable, at which point it's no simpler than a session table.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bootstrap and Log In as the First Super Admin (Priority: P1)

As the person standing up TM for the first time, I run a one-time seed script to create the first
Super Admin account, then log in through a dedicated Super Admin login page — separate from any
tenant-facing login — and land on a minimal confirmation screen proving I'm authenticated with a
recognized Super Admin session.

**Why this priority**: Nothing else in this spec has value without a way to create and use the first
Super Admin account. This is the entire demoable slice of this milestone.

**Independent Test**: Run the seed script against a database with zero existing Super Admins, confirm
exactly one `super_admins` row is created with a securely hashed password, then submit those
credentials at the dedicated login route and confirm a Super Admin session is issued and the
authenticated landing confirmation is reachable.

**Acceptance Scenarios**:

1. **Given** no Super Admin account exists yet, **When** the seed script runs with a valid email and
   password, **Then** exactly one `super_admins` row is created with the password stored only in
   hashed form.
2. **Given** a valid Super Admin account exists, **When** its credentials are submitted at the
   dedicated Super Admin login route, **Then** a Super Admin session is issued and the caller reaches
   the minimal authenticated landing confirmation.
3. **Given** the seed script has already created a Super Admin account, **When** it is run again
   without an explicit override, **Then** it makes no changes and does not create a duplicate account.

---

### User Story 2 - Super Admin and Tenant Sessions Can Never Be Confused (Priority: P1)

As the platform, when a request presents a tenant-scoped session where a Super Admin session is
required, or a Super Admin session where a tenant-scoped session is required, the request is rejected
outright — the two session types are never interchangeable at the request layer.

**Why this priority**: This is the actual security boundary "architecturally separate" is meant to
guarantee. Without it, the separate `super_admins` table and dedicated login route are cosmetic —
the real question is whether the server can ever be tricked into treating one session type as the
other. Equally critical to User Story 1, sequenced second only because it requires both session types
to exist first.

**Independent Test**: Obtain a valid Super Admin session and a valid tenant-scoped session
independently, then present each one to a route that requires the other, and confirm both attempts
are rejected — independent of any UI.

**Acceptance Scenarios**:

1. **Given** a valid tenant-scoped session, **When** it is presented to the Super Admin login route
   or any Super Admin-authenticated route, **Then** the request is rejected.
2. **Given** a valid Super Admin session, **When** it is presented to a tenant-scoped route expecting
   `request.user.tenantId`, **Then** the request is rejected rather than silently treated as a
   tenant-less or platform-wide tenant context.
3. **Given** an authenticated Super Admin request, **When** the server sets the Super Admin indicator
   used by Row-Level Security allowance clauses, **Then** that indicator is derived only from the
   server-verified session — never from any client-supplied header, cookie value, or request field.

---

### User Story 3 - Failed Logins Are Rate-Limited and Reveal Nothing (Priority: P2)

As the platform, repeated failed login attempts against the Super Admin login route are rate-limited,
and a failed attempt never reveals whether the submitted email corresponds to a real Super Admin
account.

**Why this priority**: This hardens an already-working login flow (User Stories 1–2) against brute
force and account enumeration. It's sequenced last because it protects the login path rather than
constituting it — but given the access a compromised Super Admin account grants, it is not optional
for this milestone.

**Independent Test**: Submit a wrong password for a real Super Admin email and a login attempt for a
non-existent email, and confirm both produce an identical, generic response; then exceed the failed-
attempt threshold and confirm further attempts (even with correct credentials) are refused until the
cool-down period elapses.

**Acceptance Scenarios**:

1. **Given** a real Super Admin email with a wrong password, **When** login is attempted, **Then**
   the response is identical in shape and content to a login attempt against an email that does not
   exist in `super_admins`.
2. **Given** repeated failed login attempts against the same email exceed the defined threshold,
   **When** a further attempt is made — even with the correct password — **Then** it is refused until
   the cool-down period elapses.
3. **Given** the cool-down period has elapsed, **When** the legitimate Super Admin retries with
   correct credentials, **Then** login succeeds without any manual intervention required.

---

### Edge Cases

- What happens if the seed script is run with an explicit override after a Super Admin already
  exists? It creates an additional Super Admin account (FR-014) rather than refusing — this is the
  stated escape hatch, not an error condition.
- What happens if a Super Admin session and a tenant-scoped session are somehow both applicable to
  the same request? This cannot arise by construction — a Super Admin session carries no `tenant_id`
  at all (FR-006), so the two are mutually exclusive at the session level, not just checked separately
  at the route level.
- What happens if a Super Admin account is deleted or disabled while a session for it is still active?
  Out of scope for this spec (full Super Admin account management is excluded) — the session remains
  valid until its natural expiry. Whichever future spec adds account disable/delete is responsible for
  also invalidating any active sessions for that account.
- What happens to a Super Admin session after its absolute expiry? Any further request with it is
  rejected exactly as if no session were presented at all — re-authentication is required, no silent
  renewal.
- What happens if someone tries to reach the Super Admin login route or landing confirmation from a
  tenant-facing page? It is not linked from, or discoverable via, any tenant-facing UI (FR-004) — it
  remains reachable only by someone who already knows its dedicated URL.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST maintain a dedicated `super_admins` table, entirely separate from any
  tenant-scoped user table, with no `tenant_id` column — Super Admins are not scoped to any tenant.
- **FR-002**: System MUST store, per Super Admin: a unique email, a securely hashed password (never
  plaintext), a display name, `created_at`, and `last_login_at` (null until first successful login).
  Full profile/permissions management beyond these fields is out of scope for this spec.
- **FR-003**: Password hashing MUST use a memory/CPU-hard key-derivation function with a unique,
  random per-password salt; plaintext passwords MUST NOT be logged, stored, or included in any system
  response.
- **FR-004**: System MUST provide a dedicated Super Admin login route, structurally and visibly
  separate from any tenant-scoped user login route or page, and not linked from or reachable through
  any tenant-facing UI.
- **FR-005**: The Super Admin login route MUST authenticate solely against the `super_admins` table
  and MUST NOT share credential-lookup logic with any tenant-scoped user authentication path.
- **FR-006**: On successful login, System MUST issue a session that (a) carries no `tenant_id`, (b) is
  explicitly flagged as a Super Admin session, and (c) is distinguishable at the request layer from
  every tenant-scoped session.
- **FR-007**: System MUST reject outright any request presenting a tenant-scoped session to a route
  requiring a Super Admin session, and any request presenting a Super Admin session to a route
  requiring a tenant-scoped session (User Story 2).
- **FR-008**: On a failed login attempt (wrong password, or an email not present in `super_admins`),
  System MUST return an identical, generic error response in both cases, giving no indication of
  whether the submitted email exists.
- **FR-009**: System MUST rate-limit login attempts: after a defined number of consecutive failures
  for the same email, further attempts against that email MUST be refused for a defined cool-down
  period, regardless of credential correctness.
- **FR-010**: Super Admin sessions MUST expire after a defined absolute duration; a request presenting
  an expired session MUST be treated identically to a request presenting no session.
- **FR-011**: System MUST provide a way for a Super Admin to end their own active session on demand
  (logout), immediately invalidating it server-side.
- **FR-012**: For every authenticated Super Admin request, the server MUST set a session-scoped
  Row-Level-Security indicator reflecting Super Admin status, derived only from the server-verified
  session — never from any client-supplied header, cookie, or request field (User Story 2, Acceptance
  Scenario 3).
- **FR-013**: Any Row-Level Security policy on a tenant-scoped table that must permit Super Admin
  access MUST express that access as an explicit allowance condition evaluated alongside the existing
  tenant-scoping condition (e.g., an `OR` clause referencing the server-set indicator from FR-012) —
  MUST NOT be implemented by exempting a database connection or role from Row-Level Security entirely.
  This spec establishes the pattern and the server-side mechanism that sets the indicator; applying
  this clause to any specific tenant-scoped table's policy is the responsibility of whichever spec
  introduces or already owns that table.
- **FR-014**: System MUST provide a standalone seed script — not a UI, not a network-reachable
  endpoint — that creates a Super Admin account from provided email/password input, hashing the
  password before insert.
- **FR-015**: The seed script MUST be safe to re-run: by default, if any Super Admin account already
  exists, it MUST refuse to insert another and make no changes, proceeding only when an explicit
  override is supplied.
- **FR-016**: System MUST provide a minimal authenticated landing confirmation, reachable only with a
  valid Super Admin session, that proves successful login and correct Super Admin session recognition
  (User Story 1, Acceptance Scenario 2). No further Super Admin Console functionality is required.
- **FR-017**: The Super Admin identity and session-verification mechanism established by this spec
  MUST become the canonical way the platform determines Super Admin status going forward. It
  supersedes the platform-level, role-based Super Admin mechanism from the Roles & Permissions Model
  spec (the `roles.tenant_id IS NULL` row plus the `tm_platform_reader` `BYPASSRLS` role used to check
  it), confirmed via Clarifications — see Assumptions for the migration boundary this spec does and
  does not cover.

### Key Entities

- **Super Admin**: A platform-level operator account. Attributes: unique email, hashed password,
  display name, `created_at`, `last_login_at`. No `tenant_id` — not owned by, or scoped to, any
  tenant.
- **Super Admin Session**: Represents one authenticated Super Admin login. Attributes: an opaque
  session identifier, the Super Admin it belongs to, `created_at`, absolute `expires_at`. Carries no
  `tenant_id`. Distinguishable from a tenant-scoped session at the request layer (FR-006, FR-007).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A platform operator can go from running the seed script to reaching the authenticated
  landing confirmation in under 2 minutes.
- **SC-002**: 100% of requests presenting a tenant-scoped session to a Super Admin-only route, and
  100% of requests presenting a Super Admin session to a tenant-scoped route, are rejected — verified
  across representative test scenarios.
- **SC-003**: 100% of failed login attempts (wrong password vs. unknown email) return
  indistinguishable responses, verified by comparing response content across both cases.
- **SC-004**: Login attempts are refused once the defined failure threshold is reached, verified by
  exceeding the threshold and confirming a subsequent attempt with correct credentials still fails
  until the cool-down period elapses.
- **SC-005**: Re-running the seed script against a database that already has a Super Admin account
  results in zero new rows unless the explicit override is supplied, verified by row count before and
  after.
- **SC-006**: 0 instances of an expired Super Admin session being accepted by any route, verified by
  attempting to use a deliberately expired session against the landing confirmation route.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS, consistent with prior specs — but
  `super_admins` and Super Admin sessions are platform-level tables with no `tenant_id` column at all,
  so no RLS policy applies to them (there is no tenant dimension to scope). The impact on *other*
  tenant-scoped tables is the FR-012/FR-013 pattern: an explicit Super Admin allowance clause added to
  existing RLS policies, evaluated by Postgres alongside the tenant-scoping condition — RLS remains
  the enforcement layer for Super Admin access too, not bypassed by a privileged database role.
- **Tenant-configurable vs. fixed platform-wide**: Entirely fixed platform-wide — Super Admin identity,
  authentication, and session handling are platform-operator concerns with zero tenant-level
  configurability, by definition (Super Admins are not scoped to any tenant).
- **AI-generation review/approval step**: N/A — this feature does not generate AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI evaluation.
- **Downgrade/cancellation behavior**: This is a security-foundational module. Super Admin accounts and
  sessions are entirely independent of any tenant's lifecycle — a tenant being downgraded, suspended,
  or cancelled has no effect whatsoever on Super Admin authentication, since Super Admins are not
  scoped to any tenant.
- **Design system reference**: This feature includes two UI screens (the dedicated Super Admin login
  page and the minimal authenticated landing confirmation). No design system has been locked yet per
  Principle V. Implementation of these screens MUST either reference the design system once it is
  established, or explicitly flag this as one of the features establishing it, per Principle V's
  process — matching the posture already used by prior specs' UI surfaces.
- **Demoable vs. internal**: Stakeholder-demoable. The full flow — running the seed script, logging in
  at the dedicated Super Admin login page, and reaching the authenticated landing confirmation — is a
  coherent, end-to-end demo a non-technical stakeholder can watch and follow.

## Assumptions

- **This spec supersedes Spec 1's platform-level Super Admin mechanism (FR-017), confirmed via
  Clarifications.** Spec 1 (Roles & Permissions Model) shipped a Super Admin as a special `roles` row
  (`tenant_id IS NULL`), verified via a narrow `BYPASSRLS` Postgres role (`tm_platform_reader`) used
  only by `require-platform-permission.ts`. That mechanism is exactly the anti-pattern this spec's RLS
  allowance-clause approach (FR-012, FR-013) is designed to avoid going forward. This spec does *not*
  itself migrate Spec 1's or Spec 2's existing routes (`admin-routes.ts`'s
  `requirePlatformPermission`, Spec 2's `POST /provisioning/tenants` guard) to the new mechanism — that
  migration is explicitly left as follow-up implementation work, not required by this spec's
  requirements. During the window before that follow-up work happens, two parallel ways to check "is
  this caller Super Admin" exist in the codebase — a real, if temporary, security-surface
  consideration, not a blocker for this spec.
- **Super Admin login uses a fixed platform-level path (e.g. `/platform/login`) within the existing
  Next.js app, not a dedicated admin subdomain, confirmed via Clarifications.** No subdomain-based
  request routing exists anywhere in this codebase yet (Spec 2's `tenants.subdomain` is a stored
  identifier, not wired to actual routing) — building real subdomain routing purely for this spec
  would be new infrastructure disproportionate to its scope. Path-based separation, combined with the
  mandatory session-type-rejection requirement (FR-007) and cookie scoping to that path, is treated as
  sufficient isolation for this milestone.
- **Super Admin sessions are server-side and revocable (a session record in a table, referenced by an
  opaque token in an httpOnly, Secure cookie), not a stateless signed token (e.g. JWT), confirmed via
  Clarifications.** Chosen because the requirements explicitly call out the risk of a compromised
  Super Admin account, and a server-side session can be revoked immediately (FR-011's logout, or a
  future forced-revocation capability), which a bare stateless token cannot do without its own
  server-side blocklist — at which point it is no more stateless than a session table, just more
  complex.
- Session absolute expiry defaults to 8 hours — a reasonable default for a high-privilege account,
  easily adjusted later; not treated as a structural decision requiring sign-off.
- Rate limiting defaults to locking out further attempts against the same email after 5 consecutive
  failures, for a 15-minute cool-down — reasonable, adjustable defaults, not requiring sign-off.
- The specific password-hashing algorithm (e.g. scrypt via a built-in runtime module vs. a dedicated
  package such as bcrypt/argon2) is left to planning, per constitution Principles XII–XIII — this spec
  only requires that *some* memory/CPU-hard KDF with per-password salting is used (FR-003).
- The seed script's input method (interactive prompt vs. environment variables) is left to planning;
  this spec only requires that it exists, is not a UI or endpoint, and hashes the password before
  insert (FR-014).
- Reuses the existing Next.js (`apps/web`) / Fastify (`apps/api`) stack per constitution Principle XI —
  no new frontend or backend application is introduced for this feature.
