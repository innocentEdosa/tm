# Feature Specification: Transactional Email Template Redesign

**Feature Branch**: `019-email-template-redesign`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Redesign the three transactional emails sent by TM (tenant creation, member invite, password reset) so they use a proper branded HTML template instead of plain text, and fix the tenant-creation email to include the admin's login email address in its content."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New tenant admin receives a clear, self-contained welcome email (Priority: P1)

When a new company signs up and TM provisions their tenant, the admin who was just created receives an email containing their sign-in credentials. Today that email is a bare, unbranded sentence with only the one-time password — it never states which email address the credential belongs to, and looks generic enough that recipients sometimes miss it or mistake it for spam. The admin needs an email that visually reads as a legitimate TM product email, clearly states which company/tenant was created, clearly states their login email address alongside the one-time password, and clearly states how long they have to use it.

**Why this priority**: This is the very first impression a new customer has of the product, and today's plain-text OTP-only email is the biggest content gap called out — an admin who can't tell which login the OTP belongs to (e.g. because the email was forwarded, or they manage multiple email addresses) is blocked before they ever reach the product.

**Independent Test**: Can be fully tested by provisioning a new tenant end-to-end and inspecting the resulting email: it must be independently verifiable that the email renders with branding/visual hierarchy and states both the login email and the one-time password, without needing the member-invite or password-reset flows to be touched.

**Acceptance Scenarios**:

1. **Given** a new tenant is provisioned with an admin email of `admin@acme.com`, **When** the provisioning completes successfully, **Then** the admin receives an email whose content explicitly states `admin@acme.com` as the login email, states the one-time password, states the tenant/company name, and states the 72-hour expiry — rendered with consistent TM branding and visual hierarchy rather than as a plain sentence.
2. **Given** the admin's mail client cannot render HTML, **When** the email is opened, **Then** a plain-text version is shown that still contains the same login email, one-time password, tenant name, and expiry information.

---

### User Story 2 - Invited team member receives a clear, branded invite email (Priority: P2)

When an existing tenant admin invites a new team member, that member receives an email with their one-time password. Today it is the exact same generic template used for tenant creation, giving no indication of which organization they're joining or that this is an invite rather than a new-company signup. The invited member needs an email that is visually consistent with TM's other emails but reads distinctly as a team invite: which organization they're joining, their login email, their one-time password, and the expiry/first-login requirement.

**Why this priority**: Member invites happen far more frequently than tenant creation once a company is onboarded, and the current shared/generic copy creates confusion about which organization sent the invite — but it's a lower-stakes fix than the tenant-creation content gap in User Story 1, since the OTP itself already works.

**Independent Test**: Can be fully tested by inviting a team member to an existing tenant and inspecting the resulting email independently of the tenant-creation and password-reset flows: it must state the organization name, the recipient's login email, the OTP, and the expiry, with content distinguishable from the tenant-creation email.

**Acceptance Scenarios**:

1. **Given** an admin at tenant "Acme Corp" invites `newuser@acme.com` as a team member, **When** the invite is created successfully, **Then** the recipient receives a branded email stating they're joining "Acme Corp", their login email `newuser@acme.com`, their one-time password, and the 72-hour expiry.
2. **Given** the same invite scenario, **When** the resulting email is compared to a tenant-creation email, **Then** the wording/framing differs (invite/joining language vs. new-account/welcome language) even though both share the same visual template.

---

### User Story 3 - User requesting a password reset receives a clear, branded reset email (Priority: P3)

When a user forgets their password and requests a reset, they receive an email with a reset link. Today it is plain text with no branding. The user needs an email that visually matches the other TM emails, clearly highlights the reset link/action, states the 1-hour expiry and single-use nature, and reassures the recipient it's safe to ignore if they didn't request it.

**Why this priority**: Password reset is an existing, already-functional flow (the link works today); this story is a visual/trust-and-clarity improvement rather than fixing a functional gap, so it's the lowest priority of the three even though it should ship as part of the same consistent redesign.

**Independent Test**: Can be fully tested by triggering a forgot-password request and inspecting the resulting email independently of the other two flows: it must state the expiry, single-use nature, and a safe-to-ignore note, rendered with the same branding/visual system as the other two emails.

**Acceptance Scenarios**:

1. **Given** a user requests a password reset, **When** the request succeeds, **Then** they receive a branded email with a clearly highlighted reset action/link, the 1-hour expiry, a single-use note, and a note to ignore the email if they didn't request it.

---

### Edge Cases

- What happens when the recipient's mail client blocks images or does not render HTML at all? The plain-text fallback must still contain every piece of information the HTML version does (login email, OTP/link, expiry) — no information may exist only in the HTML body.
- What happens when the mail provider is unreachable, times out, or is unconfigured? Existing behavior (operation succeeds regardless; failure is logged, not surfaced to the end user; nothing blocks tenant creation, member invite, or password-reset-token issuance) MUST be unchanged by this redesign — this feature is scoped to content and presentation only.
- What happens if a tenant/company name contains characters that could break HTML rendering (e.g. `<`, `&`)? The rendered email must display the name correctly and safely rather than breaking the layout or introducing malformed markup.
- What happens when the tenant-creation admin email and the member-invite recipient email happen to be visually similar in template (same layout)? The copy must still make the distinction (new account vs. invite) clear from the wording alone, since some recipients only skim.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST send the tenant-creation email as a styled, branded message (not a bare plain sentence) that includes: the tenant/company name, the admin's login email address, the one-time password, and the one-time-password expiry period.
- **FR-002**: The system MUST send the member-invite email as a styled, branded message that includes: the tenant/organization name being joined, the invited member's login email address, the one-time password, and the one-time-password expiry period.
- **FR-003**: The tenant-creation and member-invite emails MUST use visually consistent branding/layout with each other and with the password-reset email, while using distinct wording/framing appropriate to each event (new-account welcome vs. team invite vs. password reset).
- **FR-004**: The system MUST send the password-reset email as a styled, branded message that includes: a clearly highlighted reset action/link, the link's expiry period, a statement that the link is single-use, and a note that the recipient may ignore the email if they did not request a reset.
- **FR-005**: Every transactional email MUST be sent as a message with both an HTML representation and a plain-text representation, and the plain-text representation MUST contain every piece of information (credential/link, expiry, relevant names) present in the HTML representation.
- **FR-006**: The tenant-creation email content MUST explicitly state the admin's login email address as its own labeled piece of information, not merely imply it from the "to" address the mail client shows.
- **FR-007**: Rendering of any tenant-, admin-, or organization-supplied text (e.g. company name, full name) into the email MUST NOT allow that text to break the email's layout or inject unintended markup.
- **FR-008**: The redesign MUST NOT change when emails are triggered, what data is required to send them (beyond the login-email addition in FR-001/FR-006), or the non-blocking/failure-tolerant delivery guarantees already in place — a failed or delayed email send MUST NOT prevent or roll back tenant creation, member invite, or password-reset-token issuance.
- **FR-009**: The redesign MUST NOT introduce a new email for any event that does not already send one (e.g. no new "password successfully changed" confirmation email is in scope).

### Key Entities

- **Transactional Email**: A single outbound message tied to one of three trigger events (tenant creation, member invite, password reset). Attributes: recipient address, trigger type, subject, and the event-specific content values it must display (login email + OTP + expiry, or reset link + expiry).
- **Email Template**: The shared visual/structural presentation (branding, layout, typography, highlighted-credential treatment) applied consistently across all three transactional email types, parameterized per trigger type by its event-specific content values.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tenant-creation emails sent after this feature ships display the admin's login email address as explicit, labeled content in the message body.
- **SC-002**: 100% of the three transactional email types (tenant creation, member invite, password reset) render with consistent TM branding and visual hierarchy, verifiable by side-by-side visual review.
- **SC-003**: A recipient can identify, without reading surrounding prose, which single piece of information they need to act on (the one-time password or the reset link) within 5 seconds of opening any of the three emails, due to clear visual highlighting.
- **SC-004**: 0% of transactional emails lose any required information (credential/link, expiry, relevant names) when viewed in a plain-text-only mail client.
- **SC-005**: A recipient can distinguish a tenant-creation (new account) email from a member-invite email by wording alone, without relying on layout differences.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change. This feature touches only outbound email content/formatting for already-tenant-scoped events; no new data access paths or storage are introduced.
- **Tenant-configurable vs. fixed platform-wide**: The email branding/visual template is fixed platform-wide (TM's own product identity, not tenant white-label branding) — no tenant-specific logo/color injection is in scope here. Per-event content (tenant name, recipient email, OTP/link, expiry) is naturally tenant- and user-specific data, not a configurable template. If tenant-branded outbound email is desired later, that is a separate white-labeling feature (Principle VII) and explicitly out of scope for this redesign.
- **AI-generation review/approval step**: N/A — no AI-generated content is involved; template copy is authored directly.
- **Kirkpatrick L4/L5 data source & formula**: N/A — not a Results/ROI feature.
- **Downgrade/cancellation behavior**: N/A — not a security, budget, or evaluation module.
- **Design system reference**: This feature introduces the first branded visual surface for TM's outbound transactional email and does not yet have an established email-specific design reference. Per Principle V, the UI-UX-Pro-Max skill MUST be used during design/planning to establish the branded email template, which then becomes the binding standard for any future transactional or notification email.
- **Demoable vs. internal**: Demoable — the three redesigned emails are directly stakeholder-visible output (an actual email a non-technical stakeholder can be sent to review).

## Assumptions

- The three in-scope events already trigger an email today (tenant creation, member invite, password reset/forgot-password); this feature changes what is sent and how it looks, not which events send email.
- "Password change" in this feature's scope refers to the existing forgot-password/reset-link email, since that is the only password-related email the system currently sends; there is no existing "password successfully changed" confirmation email, and adding one is out of scope (FR-009).
- The current mail transport only sends a plain-text body; adding an HTML body alongside it is treated as an implementation detail of satisfying FR-005, to be resolved during planning rather than specified here.
- No tenant-specific logo/branding data currently exists to pull into these emails; the branded template uses TM's own fixed product identity only.
- Existing OTP expiry (72 hours) and password-reset-link expiry/single-use (1 hour) values are unchanged by this feature — the emails must state these existing values, not new ones.
