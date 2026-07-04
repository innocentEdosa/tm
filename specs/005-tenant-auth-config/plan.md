# Implementation Plan: Tenant Authentication Configuration

**Branch**: `005-tenant-auth-config` | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-tenant-auth-config/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Extends the existing `users` table (Spec 2) with credential columns (`password_hash`,
`must_change_password`, `otp_expires_at`, `failed_login_count`, `locked_until`) rather than a
competing table — exactly what Spec 2's own research anticipated. Adds three new tenant-scoped,
RLS-enforced tables (`tenant_auth_methods`, `user_sessions`, `password_reset_tokens`) and a new
`apps/api/src/tenant-auth/` module implementing full email/password login, forced password-change
after one-time-password bootstrap, forgotten-password reset, and multi-method configuration —
reusing Spec 3's already-generic `hashPassword`/`verifyPassword`/session-token helpers directly
rather than duplicating them. Extends Spec 4's `resolveTenantBySubdomain` to also return a tenant's
enabled auth methods, so the login page can conditionally render without a second lookup. Adds
`nodemailer` (SMTP) as this feature's one new dependency, to send one-time-password and
password-reset emails — confirmed with the user (2026-07-04): SMTP via an existing mailbox, not a
new transactional-email service account. New Next.js UI: the tenant login page (replacing Spec 4's
placeholder), forgot/reset/set-password pages, and an authentication + team settings area under
`/settings` (never `/admin`, per Spec 4 FR-003) — built via the UI-UX-Pro-Max skill as this spec's
explicit design priority.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 — unchanged from Specs 1–4.

**Primary Dependencies**: Fastify 5, `drizzle-orm`, `pg` (`apps/api`, all existing); Next.js 15
(`apps/web`, existing). New: `nodemailer` (`apps/api`).

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: `nodemailer`
(+ `@types/nodemailer` devDependency), `apps/api`. Purpose: send one-time-password and
password-reset emails via SMTP (spec FR-013, FR-014). Why a built-in alternative won't do: Node's
standard library has no SMTP protocol client — unlike the hashing/cookie-parsing cases this
codebase has hand-rolled elsewhere (research.md §1 of Spec 3), implementing SMTP's handshake,
STARTTLS negotiation, and MIME encoding by hand would be unreasonable and risk email
deliverability/security bugs a mature, widely-used library already handles correctly. `nodemailer`
is the de facto standard, dependency-light choice for Node SMTP. **Sign-off status**: the user
explicitly chose this approach over a transactional-email API (2026-07-04, in response to a direct
question) — confirmed again immediately before the actual `pnpm add` command runs, per Principle
XIII's literal requirement.

**Storage**: PostgreSQL — same database as Specs 1–4. New migrations: `users` table extension
(additive columns only); three new tenant-scoped tables (`tenant_auth_methods`, `user_sessions`,
`password_reset_tokens`), each RLS-enabled with the *standard* `tenant_isolation` policy shape
(research.md §3 — no narrow allowance-clause needed here, unlike Spec 4's pre-auth subdomain
lookup); grants; new permissions seeded and backfilled onto every existing tenant's HR Admin role
(mirroring `0014_seed_provision_tenant_permission.sql`'s precedent for already-live rows); a
backfilled `tenant_auth_methods` row (`email_password`) for every existing tenant. Also amends Spec
4's `resolve-tenant.ts` to additionally return enabled auth methods.

**Testing**: Vitest, `apps/api/tests/integration/` convention (real Postgres, no mocks) — this is a
security-critical spec (credential hashing, rate-limiting, enumeration protection, tenant-session
isolation), matching Specs 3–4's precedent of proving these mechanisms against real Postgres.
`apps/web`'s new UI is verified via `quickstart.md`'s manual/browser scenarios — no test runner
exists there today (Spec 4 research.md §6), unchanged by this spec.

**Target Platform**: Vercel (`apps/web`) + the existing Fastify host (`apps/api`) — unchanged.

**Project Type**: Web-service + web-app, extending both apps in place, exactly as every prior spec
has.

**Performance Goals**: No hard SLA. `scrypt`-based password/OTP hashing is deliberately CPU-hard
(Spec 3 precedent) — acceptable at expected per-tenant login volume. Email sending happens
synchronously within the request that creates an account but its failure MUST NOT fail that
request (spec Edge Cases) — the account is created regardless, with a resend path available.

**Constraints**: SMTP credentials MUST be read from environment variables, never committed. The
tenant-user session cookie MUST NOT set a `Domain` attribute — host-only scoping (browser-enforced,
zero code required) is a second, independent layer of tenant isolation alongside the RLS-based
session check (research.md §3). Every Fastify call this feature's Next.js pages make MUST include
the subdomain explicitly (sourced from the already-resolved `x-tenant-subdomain` request header,
never inferred from Host on the Fastify side) — Fastify always independently re-resolves it via
Spec 4's `resolveTenantBySubdomain`, consistent with Spec 4 FR-004/FR-010.

**Scale/Scope**: One new backend module (`apps/api/src/tenant-auth/`, ~9 files), one `users` table
migration, three new tables, a small amendment to Spec 4's `resolve-tenant.ts`, three amendments to
Spec 2's `provision-tenant.ts`/`provisioning-routes.ts` (default auth method, OTP email side
effect), six new Next.js pages/route groups, one new `next.config.ts` rewrite prefix.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | Session validation always resolves `tenant_id` from the subdomain *first* (independently, server-side), then queries `user_sessions` under the *standard* `tenant_isolation` RLS policy — a session issued for tenant A is structurally invisible under tenant B's `app.tenant_id`, no bespoke logic required (research.md §3). `app.tenant_id` for all other tenant-scoped queries remains sourced only from the verified session, never a client value. |
| II. Tenant provisioning includes org structure | N/A | This spec doesn't touch department/role structure itself, only which auth methods and permissions apply. |
| III. Forms/flows are tenant-configurable | **PASS** | This spec's entire configuration model (FR-002, FR-004, FR-017) is the direct expression of this principle — multiple methods toggleable per tenant, no code change to switch. |
| IV. Spec-before-code | **PASS** | Follows the ratified, clarified spec.md; both clarification rounds (multi-method support, email-sending approach, OTP-vs-link bootstrap) are reflected here, not invented in this plan. |
| V. Design system (locked via UI-UX-Pro-Max) | **DEFERRED, FLAGGED** | Still not formally locked as of Spec 4. This spec's login page is an explicit design priority (spec's own Constitution Alignment) and a strong candidate to be the locking moment — flagged for confirmation at implementation kickoff, not decided here. |
| VI. Plan-tier awareness | N/A | Auth method configuration is not tier-gated in this spec. |
| VII. White-labeling & structural customization | N/A | No tenant branding or org structure touched. |
| VIII. Comprehensive-version rule | **PASS** | Multiple simultaneous login methods (the more complete option) was confirmed by the requester over the simpler single-method default, consistent with this principle. |
| IX. Demoable vs. internal | **PASS** | Explicitly demoable per spec.md Constitution Alignment — full provisioning→OTP→login→settings→reset→SSO-stub flow. |
| X. Clean branch per feature | **PASS** | Work proceeds on `005-tenant-auth-config`, branched from clean `master`. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends both apps in place; no new app or framework. |
| XII. Prefer built-in/native utilities | **PASS** | Reuses Spec 3's existing `node:crypto`-based password/session helpers directly (no duplication); the one new dependency (`nodemailer`) is for a capability (SMTP) with no built-in Node equivalent, not a convenience shortcut. |
| XIII. No new package without explicit permission | **PASS** | `nodemailer` is the only new package; explicit sign-off already obtained from the user this session, re-confirmed at the actual install step. |

No unresolved `[NEEDS CLARIFICATION]` markers remain in spec.md.

## Project Structure

### Documentation (this feature)

```text
specs/005-tenant-auth-config/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── tenant-auth-api.md
│   └── nextjs-tenant-auth-pages.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure):

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   ├── users.ts                          # amended — new credential columns
│   │   ├── tenant-auth-methods.ts            # new
│   │   ├── user-sessions.ts                  # new
│   │   └── password-reset-tokens.ts          # new
│   ├── tenant-auth/                          # new module, parallel to platform-auth/
│   │   ├── cookies.ts                        # new — tm_tenant_session cookie (dev-safe Secure,
│   │   │                                     #   host-only, no Domain attribute)
│   │   ├── mailer.ts                         # new — nodemailer SMTP wrapper, OTP + reset templates
│   │   ├── otp.ts                            # new — one-time password generation
│   │   ├── tenant-user-context.ts            # new — mirrors tenant-context.ts's idiom, decorates
│   │   │                                     #   request.user from a verified user_sessions row
│   │   ├── require-tenant-user-session.ts    # new — preHandler guard (+ must-change-password gate)
│   │   ├── tenant-auth-routes.ts             # new — login/logout/me/set-password/forgot/reset
│   │   ├── tenant-auth-settings-routes.ts    # new — GET/PUT enabled methods
│   │   └── tenant-team-routes.ts             # new — add team member
│   ├── provisioning/
│   │   └── provision-tenant.ts               # amended — default auth method row + OTP email
│   │                                         #   side effect
│   ├── tenant-routing/
│   │   └── resolve-tenant.ts                 # amended (Spec 4) — also returns enabled auth methods
│   └── platform-auth/
│       ├── password.ts                       # reused as-is (hashPassword/verifyPassword/DUMMY_HASH)
│       └── session.ts                        # reused as-is (token generation/hashing)
└── drizzle/                                   # amended — new migrations on top of 0000-0018

apps/web/
├── next.config.ts                             # amended — new /tenant-api/* rewrite prefix
├── app/
│   ├── tenant/page.tsx                        # amended — login UI (unauthenticated) or minimal
│   │                                         #   confirmation (authenticated), config-driven
│   ├── forgot-password/page.tsx               # new
│   ├── reset-password/page.tsx                # new
│   ├── set-password/page.tsx                  # new — forced OTP-bootstrap flow
│   └── settings/
│       ├── authentication/page.tsx            # new — HR Admin method toggles
│       └── team/page.tsx                      # new — HR Admin add-team-member
└── .env.example                                # amended — SMTP env vars documented
```

**Structure Decision**: Extend `apps/api` and `apps/web` in place, exactly as every prior spec did.
Backend logic lives in a new `apps/api/src/tenant-auth/` module (parallel to `platform-auth/` and
`tenant-routing/`), reusing `platform-auth/password.ts` and `session.ts` directly rather than
forking them. Frontend logic extends the existing `apps/web/app/tenant/` route Spec 4 established
and adds five new page routes plus one new `next.config.ts` rewrite prefix.

## Complexity Tracking

> No Constitution Check violations require justification. Three items are tracked here for
> traceability, matching the posture established by Specs 3–4.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Build the login, reset, and settings pages before the design system is locked | Spec's Constitution Alignment requires a demoable slice for this milestone (Principle IX), and explicitly flags this screen as a design priority | Deferring until the design system locks was considered; rejected because the backend (schema, sessions, RLS, email) has no such dependency and this spec's own login page is arguably the *right* moment to lock the system, per Principle V | **Open — confirm at implementation kickoff whether this feature's login page formally locks the design system, or continues the ad hoc-pending posture every prior UI surface has used** |
| One new external dependency (`nodemailer`) | No built-in Node SMTP client exists (Technical Context) | Building a hand-rolled SMTP client was considered and rejected as unreasonable/risky for email deliverability and security; a transactional email API was also considered and explicitly declined by the user in favor of reusing existing SMTP credentials | **Resolved — sign-off obtained; SMTP credentials to be supplied before implementation** |
| `resolveTenantBySubdomain` (Spec 4) is amended to return enabled auth methods, rather than adding a second endpoint | The login page needs both the routing decision (valid/suspended/etc.) and the enabled-methods list on the same page load; a second round-trip to a parallel endpoint would be redundant | A dedicated `/tenant-auth/config` endpoint was considered; rejected as unnecessary duplication of a lookup Spec 4 already performs on every request to a candidate tenant subdomain (Principle XII) | **Resolved — additive field on an existing response, not a new endpoint** |
