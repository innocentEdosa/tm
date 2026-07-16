# Implementation Plan: Transactional Email Template Redesign

**Branch**: `019-email-template-redesign` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-email-template-redesign/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Replace TM's three plain-text transactional emails (tenant-creation OTP, member-invite OTP,
password-reset link) with a single shared, brand-consistent HTML email shell rendered three ways —
each with its own event-specific copy — plus a plain-text fallback carrying the same information.
The tenant-creation and member-invite variants each state the recipient's login email and tenant
name explicitly (closing the gap where the tenant-creation email today shows only the OTP). Achieved
by adding an `html` field to the existing `MailMessage`/`ZeptoMailSender` transport, introducing one
new template-building module (`apps/api/src/mail/email-templates.ts`) with no new dependency, and
splitting the current single `sendOneTimePasswordEmail` into two purpose-named functions
(`sendTenantCreationEmail`, `sendMemberInviteEmail`) so each call site's distinct copy requirement
(FR-003) doesn't collapse into a mode/flag parameter.

## Technical Context

**Language/Version**: TypeScript on Node.js 22 (matches `apps/api`'s existing runtime; no change)

**Primary Dependencies**: Fastify 5, Drizzle ORM (existing `tenants` table read only), the existing
`MailSender`/`ZeptoMailSender` abstraction (specs/016-email-api-mailer) — all already installed.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. The HTML
template is generated with plain TypeScript template-literal functions (string concatenation +
inline `style` attributes), not a templating/email-building package (e.g. MJML, react-email,
handlebars). Node's template literals and a small local `escapeHtml()` helper cover everything this
feature needs — no install required.

**Storage**: PostgreSQL — no schema change. One additional read-only query is added at the
member-invite call site (`SELECT name FROM tenants WHERE id = :tenantId`, RLS-scoped via the caller's
existing `request.tenantDb`, same idiom already used everywhere else in that file).

**Testing**: Vitest (`apps/api` existing `pnpm test` / `vitest run`), following the existing pattern
in `apps/api/tests/unit/mailer.test.ts` and the `RecordingMailSender` fixture
(`apps/api/tests/unit/fixtures/recording-mail-sender.ts`) to assert on `.text`/`.html`/`.subject`
without a real network call.

**Target Platform**: Existing Fastify API server (Linux), no new runtime target. Output is consumed
by third-party email clients (web, desktop, mobile) — not this codebase's own frontend — so the
"platform" that matters for design constraints is email-client HTML/CSS support, not a browser.

**Project Type**: Backend-only change within the existing `apps/api` web-service project. No frontend
(`apps/web`) change — nothing here is rendered inside the TM application itself.

**Performance Goals**: No new goal. Must stay within the existing `SEND_TIMEOUT_MS = 3000` bound
already enforced by `mailer.ts`'s `sendMail()` wrapper — template rendering is synchronous string
building and adds negligible time versus the network call it precedes.

**Constraints**: Email HTML must be self-contained — inline styles only, table-based layout (not
flexbox/grid), no external stylesheet or webfont dependency for legibility, since `MailMessage` is a
single JSON payload with no attachment/CID-image support today and many corporate mail clients
(notably Outlook desktop) strip `<style>` blocks and block remote font loads. Every value interpolated
from tenant/user-supplied data (company name, full name) MUST be HTML-escaped before insertion
(spec FR-007).

**Scale/Scope**: 3 email content variants sharing 1 visual shell; 2 files changed in the mail-transport
layer (`mail-sender.ts`, `zeptomail-sender.ts`); 1 new file (`email-templates.ts`); 3 call sites updated
(`provision-tenant.ts`, `tenant-team-routes.ts`, `tenant-auth-routes.ts`); `mailer.ts`'s public surface
changes from 2 exports to 3.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Tenant Isolation Is a Security Requirement, Not a Feature** — PASS. The one new read (tenant
  name for the member-invite email) goes through `request.tenantDb`, which already has
  `SET LOCAL app.tenant_id` applied by the existing tenant-context plugin, and `tenants` already
  carries a `tenant_isolation` RLS policy restricting a connection to `id = app.tenant_id`
  (`0009_rls_tenants.sql`) — a tenant's own row only, enforced at the data layer, not by trusting the
  request. No new cross-tenant surface is introduced.
- **II. Tenant Provisioning Includes Org Structure, Not Just an Account** — N/A. No provisioning
  behavior changes; only the notification email sent after provisioning changes.
- **III. Forms and Flows Are Tenant-Configurable, Not One-Size-Fits-All** — N/A. No form/approval-flow
  change.
- **IV. Spec-Before-Code, Always** — PASS. This plan follows `spec.md` (019), written and validated
  before this planning phase.
- **V. Design Decisions Are Delegated to the UI-UX-Pro-Max Skill, Then Locked** — PASS, by extension
  rather than re-establishment. TM's visual identity is already locked in `design-system/tm/MASTER.md`
  (produced under this principle by spec 008-desktop-shell-visual-language): navy/blue palette
  (`#0F172A` primary, `#0369A1` CTA, `#F8FAFC` background, `#020617` text), Plus Jakarta Sans
  typography, and the established spacing/shadow/card tokens. This feature does not invent a new
  design system — it adapts the already-locked one to the email-safe HTML/CSS subset (research.md
  §3), which is a materially different rendering environment (no flexbox/grid, no guaranteed webfont,
  no external stylesheet) than the desktop shell the tokens were authored for. Re-invoking the
  UI-UX-Pro-Max skill was considered and rejected for this pass: its output targets React/Tailwind/
  component-library screens, not raw table-based HTML email, and TM has no prior "email template"
  design-system page (`design-system/pages/`) to extend. Research.md §3 documents the adaptation
  explicitly (color/type/spacing mapping) so it becomes the binding reference for any future
  transactional/notification email, satisfying this principle's "propose and establish, then lock"
  intent for the email surface specifically.
- **VI. Every Module Is Plan-Tier Aware** — N/A. Transactional account/security email (OTP, invite,
  password reset) is not a gated feature; it is sent regardless of plan tier today and stays that way.
- **VII. White-Labeling and Structural Customization Go Together** — PASS / explicitly bounded. Per
  spec.md's Constitution Alignment, this feature uses TM's own fixed platform branding only — no
  tenant logo/color injection into email. Tenant-branded outbound email is out of scope here and
  deferred to a future white-labeling feature; this plan introduces no code that would make adding it
  later harder (template shell takes plain data values, not hardcoded assumptions that block
  parameterizing branding later).
- **VIII. Comprehensive-Version Rule Carries Forward** — PASS. Spec.md's User Story 2 explicitly chose
  the more complete option (three distinct, purpose-specific templates/content) over continuing to
  reuse one generic OTP template for two different events, and this plan carries that through by
  splitting the function, not by adding an internal `kind` flag that would silently keep the copies
  merged.
- **IX. Demoable vs. Internal Work Is Explicit** — PASS. Demoable, per spec.md — the three rendered
  emails are the literal, stakeholder-visible deliverable.
- **X. Every Feature Starts in a New Branch, from a Clean Working Tree** — PASS. Branch
  `019-email-template-redesign` was created from `master` with a clean tree (the only untracked file,
  `TM.code-workspace`, is an unrelated local IDE artifact, not pending feature work).
- **XI. Stack Is Fixed: Next.js Frontend, Fastify Backend** — PASS. Backend-only (`apps/api`, Fastify).
  No frontend framework touched or introduced.
- **XII. Prefer Built-In/Native Utilities Over New Dependencies** — PASS. See "New Dependencies
  Requiring Justification" above — hand-written template functions cover the need.
- **XIII. No New Package Is Installed Without Explicit Permission** — PASS. No install is planned;
  if research later surfaces a need, it will be raised for explicit sign-off before any install
  command runs, per this principle.

**Quality Bar** (non-principle checklist items):
- Data-model tenant-isolation impact stated above (I) — no change, one RLS-scoped read added.
- No departments/roles/permissions/forms/approval-flow touched — configurability line N/A.
- No AI-generated content — N/A.
- No Kirkpatrick L4/L5 — N/A.
- Not a security/budget/evaluation module in the downgrade/cancellation sense — N/A (this is the
  email transport for existing account-bootstrap/reset events, not a gated module).
- New "UI screen" — N/A in the literal sense (no in-app screen), but the analogous design-system
  gate is addressed under Principle V above.

**Result: PASS — no violations, Complexity Tracking table not needed.**

## Project Structure

### Documentation (this feature)

```text
specs/019-email-template-redesign/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── mail-transport-interface.md
│   └── email-template-builders.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── mail/
│   │   ├── mail-sender.ts          # MODIFIED — MailMessage gains `html: string`
│   │   ├── zeptomail-sender.ts     # MODIFIED — send() posts `htmlbody` alongside `textbody`
│   │   └── email-templates.ts      # NEW — shared shell + escapeHtml() + 3 builder functions
│   ├── tenant-auth/
│   │   ├── mailer.ts               # MODIFIED — sendOneTimePasswordEmail split into
│   │   │                           #   sendTenantCreationEmail / sendMemberInviteEmail;
│   │   │                           #   sendPasswordResetEmail keeps its signature, new content
│   │   └── tenant-auth-routes.ts   # MODIFIED — forgot-password call site (content only, no
│   │                               #   signature change)
│   ├── provisioning/
│   │   └── provision-tenant.ts     # MODIFIED — calls sendTenantCreationEmail(to, otp, tenantName)
│   └── tenant-auth/
│       └── tenant-team-routes.ts   # MODIFIED — adds one tenant-name read, calls
│                                   #   sendMemberInviteEmail(to, otp, tenantName)
└── tests/
    └── unit/
        ├── email-templates.test.ts        # NEW — builder output (subject/text/html) per variant
        ├── mailer.test.ts                  # MODIFIED — cover the 3 renamed/updated exports
        └── zeptomail-sender.test.ts        # MODIFIED — asserts htmlbody is sent
    (existing integration tests under tests/integration/ that assert on OTP-email side effects are
    updated for the renamed function, not rewritten in scope/behavior)
```

**Structure Decision**: Single existing project (`apps/api`), no new top-level directory. All changes
land inside the already-established `mail/` and `tenant-auth/` modules from spec 016
(email-api-mailer), keeping the provider-agnostic boundary that spec set up (`MailSender`) intact —
this feature only widens the payload the boundary carries (`text` → `text` + `html`) and adds one
new template-building module beside it, rather than introducing a parallel system.
