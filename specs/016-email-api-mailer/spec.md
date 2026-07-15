# Feature Specification: Email API Mailer

**Feature Branch**: `016-email-api-mailer`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Replace the current SMTP-based email transport (apps/api/src/tenant-auth/mailer.ts, using nodemailer against an SMTP server — currently Mailtrap's sandbox, configured via SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM) with a transactional-email HTTP API, initially ZeptoMail (Zoho's transactional email API), but designed so the provider can be swapped again later without touching any of the three existing call sites (provisioning/provision-tenant.ts's one-time-password email on tenant provisioning, tenant-auth/tenant-team-routes.ts's one-time-password email on team invite, tenant-auth/tenant-auth-routes.ts's password-reset email) — provider changes are expected to recur, not a one-time migration. Introduce a provider-agnostic mail-sending interface that mailer.ts's two existing exported functions (sendOneTimePasswordEmail(to, otp), sendPasswordResetEmail(to, resetLink)) delegate to internally, with a ZeptoMail implementation as the first (and currently only) concrete adapter behind it — swapping providers in the future means adding one new adapter file and changing which one is wired in, not editing any call site or the public function signatures. Call ZeptoMail's REST API directly via Node's built-in fetch rather than installing an SDK, consistent with this codebase's 'prefer built-in utilities over new dependencies' principle — no new package unless a direct API call genuinely can't cover ZeptoMail's request/response shape, in which case state exactly why and get explicit sign-off before installing anything. Preserve every existing behavioral guarantee exactly: a failed or unreachable send must never fail the operation that triggered it; when no provider credentials are configured, sending is skipped with a logged warning, not attempted; the actual email content stays as-is — this is a transport swap, not a content or template change. Config moves from the current SMTP_* env vars to provider-agnostic names (e.g. MAIL_API_TOKEN, MAIL_FROM_EMAIL). Out of scope: new email types or templates, an HTML email template system, delivery-status webhooks/tracking, retry/queueing logic, and migrating away from any other use of SMTP if one exists elsewhere in the codebase (there is currently only this one mailer module)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Existing Emails Keep Arriving, Now Sent via an HTTP API (Priority: P1)

As the platform, when a one-time-password (account setup or team invite) or password-reset email needs to go out, I send it through ZeptoMail's HTTP API instead of an SMTP connection — the recipient receives the exact same email they do today, and the operation that triggered it (provisioning, invite, or password-reset request) succeeds whether or not the send itself works.

**Why this priority**: This is the entire migration — the other stories are about how the code is structured so *future* swaps are cheap, but this story alone (even without the abstraction) delivers the actual goal: emails keep working, now over an API instead of SMTP. Nothing else in this spec matters if this doesn't work.

**Independent Test**: Trigger each of the three existing email-sending flows (tenant provisioning, team invite, forgot-password) with valid ZeptoMail credentials configured, and confirm the recipient receives an email with the same subject/body as today, sent via ZeptoMail's API rather than an SMTP connection.

**Acceptance Scenarios**:

1. **Given** valid ZeptoMail credentials are configured, **When** a tenant is provisioned or a team member is invited, **Then** the new admin/invitee receives a one-time-password email with the same subject and body text as today, sent via ZeptoMail's API.
2. **Given** valid ZeptoMail credentials are configured, **When** a user requests a password reset, **Then** they receive a password-reset email with the same subject and body text as today, sent via ZeptoMail's API.
3. **Given** ZeptoMail's API is unreachable, rejects the request, or times out, **When** any of the three triggering operations runs, **Then** that operation still completes successfully (the account/invite/reset-token is created) — the failed send is logged but never surfaces as a failure to the caller.
4. **Given** no ZeptoMail credentials are configured (the default state in tests and fresh dev environments), **When** any of the three triggering operations runs, **Then** the operation completes successfully, no network call to ZeptoMail is attempted, and a warning is logged noting the send was skipped.

---

### User Story 2 - Swapping Providers Later Touches Nothing but One New Adapter (Priority: P2)

As whoever maintains this codebase, when the team decides to move off ZeptoMail to a different provider (expected to happen more than once), I add one new adapter behind the existing mail-sending interface and change which adapter is wired in — none of the three call sites, their function signatures, or any code outside the mailer module itself needs to change.

**Why this priority**: Explicitly why this spec exists as a design problem, not just a provider migration — the stakeholder has stated provider changes recur. Sequenced after User Story 1 because the abstraction only matters once the first real swap (SMTP → ZeptoMail) is working; it's the structural guarantee, not the immediate functional need.

**Independent Test**: With ZeptoMail's adapter already working (User Story 1 complete), add a second, throwaway adapter implementing the same interface, wire it in instead, and confirm the three call sites required zero changes and their public behavior (parameters, return type, non-blocking-failure guarantee) is identical.

**Acceptance Scenarios**:

1. **Given** the mail-sending interface and its ZeptoMail adapter exist, **When** a second adapter implementing the same interface is introduced and wired in as the active one, **Then** no call site (`provision-tenant.ts`, `tenant-team-routes.ts`, `tenant-auth-routes.ts`) or the two public mailer functions' signatures require any change.
2. **Given** a provider swap has happened, **When** the same three triggering operations run, **Then** they exhibit the identical non-blocking-failure and skip-when-unconfigured behavior verified in User Story 1, regardless of which adapter is active.

---

### User Story 3 - Configuration Doesn't Change Names on Every Provider Swap (Priority: P3)

As whoever operates this system's environment configuration, I set provider-agnostic environment variable names once, and a future provider swap changes only the values (and, if a provider genuinely needs a differently-shaped credential, adds to rather than renames the existing variables) — not a cascade of env-var renames across every environment (local, staging, production) each time.

**Why this priority**: Lowest priority — a real but secondary convenience next to the emails-still-work (US1) and code-structure (US2) guarantees; still worth stating explicitly since the stakeholder called out env-var churn as part of the recurring-swap pain.

**Independent Test**: Confirm the mailer module reads only provider-agnostic environment variable names (not `SMTP_*`, not a ZeptoMail-specific name) at any point outside the ZeptoMail adapter file itself.

**Acceptance Scenarios**:

1. **Given** the codebase after this change, **When** searching for environment variable reads related to email sending, **Then** every reference outside the ZeptoMail adapter file uses a provider-agnostic name, and the old `SMTP_*` variables are no longer read anywhere.

---

### Edge Cases

- What happens if ZeptoMail's API returns a non-2xx response (e.g. invalid recipient, invalid API token, rate-limited)? The system MUST treat this the same as a network failure — log it and let the triggering operation succeed regardless (FR-004), with no distinction made between "provider rejected the request" and "provider unreachable," consistent with today's SMTP behavior which also does not distinguish delivery-level failures from connection-level ones.
- What happens if the ZeptoMail API call hangs (slow network, provider outage without a fast failure)? The system MUST bound the attempt with a timeout so the triggering request is never stalled waiting on it (mirrors today's SMTP `connectionTimeout`/`socketTimeout` guarantee).
- What happens if only some of the required provider configuration is present (e.g. an API token but no from-address)? The system MUST treat this as "not configured" — skip and warn, the same as if nothing were set — rather than attempting a call that's certain to fail.
- What happens to the existing `SMTP_*` environment variables in already-deployed environments after this ships? They become inert (no longer read) — removing them from actual environment configuration is an operational follow-up outside this spec's code changes, not something the code needs to detect or warn about.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST send both existing email types — the one-time-password email (used by both tenant provisioning and team invites) and the password-reset email — via an HTTP-API-based transport instead of SMTP, with subject and body content unchanged from today.
- **FR-002**: System MUST expose email sending through a provider-agnostic interface such that the three existing call sites reference no provider-specific type, function, or configuration value directly — only the two existing public functions (`sendOneTimePasswordEmail`, `sendPasswordResetEmail`).
- **FR-003**: System MUST implement ZeptoMail as the initial, currently-only concrete adapter behind that interface.
- **FR-004**: System MUST NOT let an email-send failure (network error, non-2xx response, or timeout) fail or block the operation that triggered it — tenant provisioning, team invite, and password-reset requests MUST all complete successfully regardless of send outcome.
- **FR-005**: System MUST skip attempting a send — logging a warning instead — when the configured provider's required credentials are absent or incomplete, without making any network call, so the test suite and any unconfigured environment continue to run with zero email configuration (as today).
- **FR-006**: System MUST bound every send attempt with a timeout so an unreachable or slow provider can never stall the triggering request indefinitely.
- **FR-007**: System MUST read only provider-agnostic environment variable names outside the ZeptoMail adapter itself; the previous `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` variables MUST no longer be read anywhere in the codebase after this change.
- **FR-008**: System MUST NOT introduce a new npm dependency for the ZeptoMail integration unless a direct HTTP call via `fetch` cannot express ZeptoMail's request/response contract — any proposed dependency MUST be explicitly named with justification and receive sign-off before installation.
- **FR-009**: System MUST log every failed send attempt (to the existing logging mechanism) exactly as today, so failures remain observable even though they never block the triggering operation.

### Key Entities

- **Mail Sender (interface)**: The provider-agnostic contract the two existing public mailer functions send through — takes a recipient, subject, and body, and performs (or skips) the actual delivery. Not a data entity; an internal code boundary that the rest of the system (the three call sites) never sees past.
- **ZeptoMail Adapter**: The first concrete implementation of the Mail Sender interface — translates a send request into a ZeptoMail API call, holding all ZeptoMail-specific knowledge (endpoint, auth, request shape) so nothing outside this one adapter needs to know ZeptoMail exists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of one-time-password and password-reset emails sent after this change go out via the HTTP-API transport, with zero SMTP connections made by the running application.
- **SC-002**: 100% of the three triggering operations (tenant provisioning, team invite, password-reset request) complete successfully in each of three simulated failure modes — provider unreachable, provider returns an error, provider not configured — verified by direct test.
- **SC-003**: Swapping the active provider requires changes to exactly one adapter file and its wiring point — zero changes to any of the three existing call sites or the two public mailer function signatures — verified by adding a second adapter and diffing the changeset.
- **SC-004**: 100% of the existing test suite continues to pass with zero email-provider credentials configured in the test environment, matching today's behavior exactly.
- **SC-005**: Zero new npm dependencies are added, unless one was explicitly proposed with justification and approved beforehand.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: N/A — no tenant-scoped table or query is touched; this is a platform-level transport swap inside a shared, non-tenant-scoped module.
- **Tenant-configurable vs. fixed platform-wide**: N/A — no departments, roles, permissions, forms, or approval flows are involved. Email transport/provider is a fixed, platform-wide operational concern, not something any tenant configures.
- **AI-generation review/approval step**: N/A — this feature does not generate AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI evaluation.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: N/A — no UI screens; this is a backend-only transport-layer change.
- **Demoable vs. internal**: Internal/infrastructure-only. There is no new UI and nothing a non-technical stakeholder watches directly during a demo; the only externally observable effect is that the same emails keep arriving, now via a different transport (verifiable by checking a test inbox, not by watching a screen).

## Assumptions

- ZeptoMail's REST API accepts one JSON POST per email — recipient, subject, and a plain-text body — authenticated via an API-token-style header, consistent with typical transactional-email HTTP APIs. The exact request/response contract is confirmed against ZeptoMail's actual API documentation during planning, not assumed further here.
- The sender ("from") identity used today (`SMTP_FROM`) must already be a verified/authorized sender in the ZeptoMail account; provisioning that verification is an account-setup/operational task outside this spec's code changes.
- Email content stays plain-text, exactly as today — ZeptoMail's API is assumed to accept a plain-text body field; no HTML template work is introduced by this spec (see Out of Scope in Input).
- No queueing or retry system is introduced — a failed send is logged and dropped, fire-and-forget, exactly like today's SMTP behavior. Retry/queueing is explicitly out of scope per the stakeholder's own framing.
- This spec covers the single existing mailer module (`apps/api/src/tenant-auth/mailer.ts`) and its three call sites — confirmed via codebase search to be the only place email is sent from today.
- The previous `SMTP_*` environment variables becoming inert in already-deployed environments (rather than being actively removed by this change) is acceptable — cleaning up unused environment configuration in deployed environments is an operational follow-up, not a code change this spec is responsible for.
