# Phase 0 Research: Transactional Email Template Redesign

No `[NEEDS CLARIFICATION]` markers remained in spec.md, so this research resolves implementation-level
unknowns surfaced while filling in `plan.md`'s Technical Context, not spec ambiguity.

## §1. Carrying an HTML body through the existing mail transport

**Decision**: Add `html: string` to `MailMessage` (`apps/api/src/mail/mail-sender.ts`), and have
`ZeptoMailSender.send()` (`apps/api/src/mail/zeptomail-sender.ts`) include `htmlbody: message.html`
in the JSON body it already posts to `POST https://api.zeptomail.com/v1.1/email`, alongside the
existing `textbody: message.text`. ZeptoMail's send-email endpoint accepts both fields on the same
request (multipart-equivalent single JSON call) — no second API call, no content negotiation needed.

**Rationale**: This is the minimal change that satisfies spec FR-005 (HTML + plain-text, no
information loss) without touching the provider-agnostic boundary spec 016 established
(`MailSender`/`isConfigured()`/`send()`). Every existing guarantee in `mailer.ts`'s `sendMail()`
wrapper (skip-when-unconfigured, non-blocking failure, bounded timeout) is orthogonal to payload
shape and needs no change.

**Alternatives considered**:
- *Separate `sendHtml()` method on `MailSender`* — rejected: doubles the interface surface for no
  behavioral gain: every current and near-future template variant wants both bodies sent together in
  one delivery, not chosen independently per call.
- *Attachment/CID-embedded images for branding* — rejected: `MailMessage`/ZeptoMail's JSON payload has
  no attachment field wired up today, and adding one is unrequested scope; inline SVG/text-based
  branding (research §3) avoids needing it entirely.

## §2. No new dependency for HTML generation

**Decision**: Build the HTML as plain TypeScript template-literal functions with inline `style="..."`
attributes and a table-based layout, plus a small local `escapeHtml()` helper for interpolated
values. No templating engine, email-builder library, or markdown-to-html package is added.

**Rationale**: Constitution Principles XII–XIII require checking built-ins/existing dependencies
before adding a package, and require explicit sign-off before any install. Three fixed-shape emails
sharing one shell is well within what a handful of string-building functions can express clearly —
there is no looping/conditional-heavy templating need that would justify a dependency's maintenance
and supply-chain cost.

**Alternatives considered**:
- *MJML / react-email / handlebars* — rejected per Principle XIII without an explicit ask; also each
  pulls in a build step or React runtime this backend-only Fastify service doesn't otherwise have.
- *Raw `text` body only (status quo)* — rejected: fails spec FR-001–FR-004's "styled, branded message"
  requirement outright.

## §3. Visual design: adapting the already-locked design system to email-safe HTML

**Decision**: Reuse the tokens already locked in `design-system/tm/MASTER.md` (established under
Constitution Principle V by spec 008-desktop-shell-visual-language), mapped to what email clients can
actually render:

| Token (MASTER.md) | Value | Email use |
|---|---|---|
| Primary | `#0F172A` | Heading text, wordmark |
| CTA/Accent | `#0369A1` | Highlighted OTP/reset-link block, button-style CTA |
| Background | `#F8FAFC` | Card/content background inside the email body |
| Text | `#020617` | Body copy |
| Heading/body font | Plus Jakarta Sans | `font-family: 'Plus Jakarta Sans', -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif` — declared for clients that fetch it, with the same web-safe stack MASTER.md's own body text falls back to, since no `<link>`/`@import` is guaranteed to load in a mail client |
| Spacing (`--space-md` / `--space-lg`) | 16px / 24px | Card padding, paragraph spacing |
| Card style | `border-radius: 12px`, `background: #F8FAFC` | The single content card each email is built inside |

**Layout structure (all three variants share this shell)**:
1. Full-width neutral outer background, centered inner table capped at `600px`.
2. Header row: TM wordmark in Primary color, no logo image dependency (avoids remote-image blocking).
3. Heading (event-specific, e.g. "Welcome to TM" / "You've been invited to join {tenant}" / "Reset
   your password").
4. Body copy paragraph(s) with the event-specific facts (tenant name, login email, OTP, or reset
   link) — the login email and OTP always rendered as separate, clearly labeled lines, not folded
   into a sentence, per spec FR-001/FR-002/FR-006 and SC-003 ("identify the one thing to act on within
   5 seconds").
5. Highlighted block: for OTP emails, a monospace, letter-spaced, CTA-colored-border code box; for
   the reset email, a solid CTA-colored (`#0369A1`) button-styled link (`<a>` styled as a button,
   since real `<button>` is unreliable in email).
6. Footer: expiry/security note in muted secondary color (`#334155`), plus the ignore-if-not-you note
   on the reset email.

**Rationale**: Satisfies Principle V's intent (one coherent, non-ad-hoc visual language) by extending
the system that already exists rather than inventing colors/fonts specific to this feature, while
respecting the real constraint that email HTML is not the same rendering environment as the in-app
shell (research §4 covers the compatibility rules this shell must follow).

**Alternatives considered**:
- *Full UI-UX-Pro-Max skill re-run for a bespoke email palette* — rejected for this pass (see plan.md
  Constitution Check §V) — would produce a second, divergent brand voice for the one surface
  (outbound email) where consistency with the in-app product matters most for trust.
- *Plain-text-styled "letter" look (no card/color at all)* — rejected: fails spec's explicit
  "branded, not a bare sentence" requirement and SC-002 (consistent branding/visual hierarchy).

## §4. Email-client HTML/CSS compatibility rules this shell must follow

**Decision**: Table-based layout (`<table role="presentation">` wrappers, not `<div>` flex/grid),
every style declared inline on the element (`style="..."`), no `<style>` block relied upon as the sole
source of critical styling, `max-width: 600px` fixed container, no external stylesheet or remote font
`<link>` required for legibility (system-font fallback always present), no background images.

**Rationale**: This is a correctness requirement, not a style preference — Outlook desktop (Word
rendering engine) ignores flexbox/grid/most modern CSS and can strip `<style>` blocks; Gmail and
others variably block remote assets by default. Building any other way would make the "renders as a
proper branded email" requirement (spec FR-001–FR-004) fail for a large share of real recipients, so
it is treated as part of satisfying the functional requirement, not extra scope.

**Alternatives considered**: None seriously — this is standard, well-established email-HTML practice
rather than a genuine design choice with tradeoffs to weigh.

## §5. Differentiating tenant-creation vs. member-invite content

**Decision**: Split the current single `sendOneTimePasswordEmail(to, otp)` export into two
purpose-named functions: `sendTenantCreationEmail(to, otp, tenantName)` and
`sendMemberInviteEmail(to, otp, tenantName)`. Both call the same underlying shell/template code
internally but pass different copy strings and both now also require `tenantName`.
`sendPasswordResetEmail(to, resetLink)` keeps its existing name and signature — only its rendered
content changes.

**Rationale**: Spec FR-002/FR-003 and User Story 2 (spec.md) require the two OTP emails to read
distinctly (new-account welcome vs. team invite) even while sharing a visual shell. A single function
taking a `kind: "creation" | "invite"` flag was considered and rejected in favor of two named exports
— per Constitution Principle VIII (comprehensive-version rule) and this codebase's own established
style (e.g. `sendOneTimePasswordEmail` vs. `sendPasswordResetEmail` are already two distinct named
functions, not one parameterized one), a boolean/enum "mode" flag on a single function hides the
distinction spec.md explicitly asked to make visible, and named exports read clearly at each call
site without needing to trace a flag's meaning back to this file.

**Alternatives considered**:
- *One `sendOneTimePasswordEmail(to, otp, { kind, tenantName })` with a mode flag* — rejected, see
  rationale above.
- *Keep `sendOneTimePasswordEmail` name, add an optional `context` param defaulted to "invite"
  behavior* — rejected: an optional param whose absence silently changes copy is exactly the kind of
  implicit behavior this codebase's existing comments (e.g. `mailer.ts`'s own doc comments) avoid;
  explicit two-function naming makes both call sites self-documenting.

## §6. Sourcing the tenant name at each call site

**Decision**: `provision-tenant.ts` already has `createdTenant.name` in scope at the point it calls
the (renamed) `sendTenantCreationEmail` — no new query needed there. `tenant-team-routes.ts` does not
currently hold the tenant's name (only `tenantId` from `request.user`), so one additional read is
added: `request.tenantDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))`,
using the `tenants` Drizzle schema already imported elsewhere in this codebase
(`apps/api/src/db/schema/tenants.ts`).

**Rationale**: `request.tenantDb` already has `SET LOCAL app.tenant_id` applied by the existing
tenant-context plugin, and `tenants` carries a `tenant_isolation` RLS policy
(`apps/api/drizzle/0009_rls_tenants.sql`) restricting any read through that connection to
`id = current_setting('app.tenant_id')::uuid` — i.e., a tenant can only ever read its own row through
this path. This is the same idiom every other tenant-scoped read in this file already uses; no new
RLS policy or platform-level (`fastify.db`) access is needed or appropriate here (Constitution
Principle I).

**Alternatives considered**:
- *Denormalize tenant name onto the session/`request.user` object* — rejected as out of scope: would
  touch the session/auth-context layer (`tenant-user-context.ts`) for a single call site's benefit;
  the one extra indexed-PK lookup this feature needs is cheap and self-contained.

## §7. "Login email" content requirement needs no new parameter

**Decision**: The email address the tenant-creation and member-invite messages must display as the
"login email" (spec FR-001, FR-002, FR-006) is the same value already passed as `to` at both call
sites (`createdAdmin.email` / `createdUser.email` — the account's own email IS its login). No new
parameter is introduced for this; the template builders simply also render the existing `to` value in
the body copy as a labeled line ("Your login email: …"), rather than only using it as the envelope
recipient.

**Rationale**: Confirmed by reading both call sites (`provision-tenant.ts`,
`tenant-team-routes.ts`) — there is no separate "contact email" vs. "login email" concept anywhere in
this codebase's user model; they are the same field. This keeps FR-008's constraint (no new required
input data beyond what FR-001/FR-006 need) satisfied exactly, since the value already exists at the
call site.

**Alternatives considered**: None — this was a verification step (does the data already exist?), not
a genuine design choice.

## §8. Password-reset copy values

**Decision**: State the existing `RESET_TOKEN_VALIDITY_MS = 60 * 60 * 1000` (1 hour, defined in
`tenant-auth-routes.ts`) and existing single-use enforcement (`used_at IS NULL` check at redemption,
already implemented) directly in the redesigned copy. No logic change.

**Rationale**: Spec explicitly scopes this feature to content/presentation only (FR-008); the values
to state were verified against the current implementation rather than assumed, so the new copy stays
accurate.

**Alternatives considered**: None — value confirmed, not chosen.

## §9. OTP expiry copy value

**Decision**: State the existing `OTP_VALIDITY_MS = 72 * 60 * 60 * 1000` (72 hours, defined in
`apps/api/src/tenant-auth/otp.ts`) in both the tenant-creation and member-invite templates. No logic
change.

**Rationale**: Same as §8 — verified against source rather than assumed.

**Alternatives considered**: None.
