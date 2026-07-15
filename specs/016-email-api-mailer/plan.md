# Implementation Plan: Email API Mailer

**Branch**: `016-email-api-mailer` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-email-api-mailer/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Replace `apps/api/src/tenant-auth/mailer.ts`'s `nodemailer`/SMTP transport with a small
provider-agnostic `MailSender` interface (`isConfigured()` + `send()`), and a ZeptoMail
implementation of it that calls ZeptoMail's REST API (`POST https://api.zeptomail.com/v1.1/email`)
directly via Node's built-in `fetch` — no SDK. `mailer.ts`'s two existing exported functions
(`sendOneTimePasswordEmail`, `sendPasswordResetEmail`) keep their exact signatures and now delegate
to a single active `MailSender`, with the non-blocking-failure, skip-when-unconfigured, and
bounded-timeout guarantees enforced once, centrally, in `mailer.ts` itself — not duplicated per
adapter — so a future provider swap (the stakeholder expects more than one) only ever means adding a
new file implementing `MailSender` and changing the one line that wires it in. `SMTP_*` env vars are
replaced with provider-agnostic names (`MAIL_API_TOKEN`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`,
`MAIL_API_URL`). No database change, no new UI, no new dependency.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20, unchanged from every prior spec.

**Primary Dependencies**: None new. Node 20's global `fetch` and `AbortSignal.timeout()` (both
built in, no import) cover ZeptoMail's entire request/response contract — a single JSON `POST` with a
bearer-style header (research.md §1). Existing Fastify/Vitest stack, unchanged.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. ZeptoMail
publishes an official `zeptomail` npm SDK, but it wraps exactly the same single JSON `POST` `fetch`
already covers natively — installing it would add a supply-chain dependency for a request shape
simple enough to construct directly (research.md §2). No install command runs in this feature.

**Storage**: N/A — no table, no migration, no read/write against Postgres anywhere in this feature.
This is an outbound-HTTP-only integration.

**Testing**: Vitest. Unlike every prior spec's integration tests (which need a real Postgres
connection), the two units this feature adds — the ZeptoMail adapter and `mailer.ts`'s wrapper logic
— are pure, no-DB, no-server logic, so they belong in `apps/api/tests/unit/` (the existing, so-far
single-occupant convention: `effective-permissions.test.ts`), mocking `global.fetch` directly via
Vitest's `vi.stubGlobal` (research.md §6) rather than hitting ZeptoMail's real API in CI. The three
existing integration tests that exercise the call sites indirectly (e.g.
`provision-tenant-otp-email.test.ts`) are unchanged and continue to pass with no credentials
configured, proving the skip-when-unconfigured path end-to-end without any test-suite changes.

**Target Platform**: Linux server (Railway), the same long-running Fastify process every prior spec
runs in — unchanged.

**Project Type**: Backend-only, single-module refactor (one interface, one new adapter file,
`mailer.ts` amended in place) — no UI surface, no demoable screen.

**Performance Goals**: No spec-mandated number. Each send attempt is bounded to a fixed timeout
budget (research.md §4 — chosen as 3000ms, a single HTTPS request-response round trip rather than
raw SMTP's multi-step `connectionTimeout`/`greetingTimeout`/`socketTimeout` handshake the old
transport bounded separately) so an unreachable/slow ZeptoMail can never stall the caller (FR-006).

**Constraints**: The non-blocking-failure and skip-when-unconfigured guarantees (FR-004, FR-005) MUST
hold regardless of which `MailSender` is active — enforced structurally by living in `mailer.ts`'s
wrapper, never duplicated inside an adapter (research.md §3). No ZeptoMail-specific env var name may
be read outside `zeptomail-sender.ts` (FR-007).

**Scale/Scope**: Two email types, three call sites (unchanged), one new interface, one new adapter
file, one amended module. No scale concern — this is a low-volume transactional-email path (OTP and
password-reset emails only), not bulk/marketing sending.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | N/A | No tenant-scoped table, query, or RLS policy is touched — this module sends email; it does not read or write tenant data. |
| II. Tenant provisioning includes org structure | N/A | Not a provisioning-flow change; the *call sites* that happen to live in provisioning code are unchanged, only what they call into. |
| III. Forms/flows are tenant-configurable | N/A | No form, approval flow, or tenant-facing configuration is introduced. |
| IV. Spec-before-code | **PASS** | This plan follows the ratified spec.md; no unresolved `[NEEDS CLARIFICATION]` markers existed going into planning (the stakeholder's own description already resolved provider choice and the swap-friendly-abstraction requirement). |
| V. Design system (locked via UI-UX-Pro-Max) | N/A | No UI screen — backend-only transport swap, explicitly internal/infrastructure-only per spec.md's Constitution Alignment. |
| VI. Plan-tier awareness | N/A | Not a gated feature; every tenant's transactional emails (OTP, password reset) send the same way regardless of plan tier, unchanged from today. |
| VII. White-labeling & structural customization | N/A | No tenant branding, structure, or workflow is touched. Email content stays exactly as today (spec Out of Scope: no template system). |
| VIII. Comprehensive-version rule | N/A | No conflicting-scope tradeoff surfaced — the provider-agnostic-interface approach was the stakeholder's own explicit request, not a smaller option chosen over a larger one. |
| IX. Demoable vs. internal | **PASS** | Spec.md states this explicitly: internal/infrastructure-only, no new UI. Reaffirmed here — the only observable effect is the same emails still arriving, via a different transport. |
| X. Clean branch per feature | **PASS** | Branch `016-email-api-mailer` created from a clean `master` (Tenant Management from Spec 015 already merged) before any implementation work began. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends the existing `apps/api` (Fastify) app in place; no alternative runtime or framework introduced. Zero `apps/web` changes — this feature has no frontend surface. |
| XII. Prefer built-in/native utilities | **PASS** | The entire ZeptoMail integration is a native `fetch` call plus `AbortSignal.timeout()` for the timeout budget — both Node 20 built-ins, no new package (research.md §1–§2). |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | No new dependency is proposed anywhere in this plan (see Technical Context and research.md §2). |

No unresolved `[NEEDS CLARIFICATION]` markers remain. Spec-level ambiguity was fully resolved during
`/speckit-specify` (provider = ZeptoMail; swap-friendly abstraction explicitly requested) before this
plan was written.

## Project Structure

### Documentation (this feature)

```text
specs/016-email-api-mailer/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/             # Phase 1 output (/speckit-plan command)
│   ├── mail-sender-interface.md
│   └── zeptomail-api.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure):

```text
apps/api/
├── src/
│   ├── mail/                              # new module
│   │   ├── mail-sender.ts                  # new — MailMessage type + MailSender interface
│   │   └── zeptomail-sender.ts             # new — ZeptoMail's implementation of MailSender
│   └── tenant-auth/
│       └── mailer.ts                       # amended — same two exported functions, now delegate
│                                            #           through mail/mail-sender.ts's active sender,
│                                            #           owns the skip/timeout/non-blocking wrapper
├── tests/
│   └── unit/
│       ├── zeptomail-sender.test.ts        # new — fetch mocked, request/response shape
│       └── mailer.test.ts                  # new — fake MailSender double, wrapper guarantees
└── .env.example                            # amended — SMTP_* replaced with MAIL_*

# No apps/web changes — this feature has no frontend surface.
```

**Structure Decision**: Extend `apps/api` in place, exactly as every prior spec has — no new
top-level app or package. The provider-agnostic interface and its first adapter live in a new
`apps/api/src/mail/` module (parallel to existing single-purpose modules like `tenant-routing/`),
kept deliberately separate from `tenant-auth/mailer.ts` itself — `mailer.ts` is the stable public
surface the rest of the codebase already imports from (three call sites), while `mail/` is the
swappable internals nothing outside `mailer.ts` should ever import directly.

## Complexity Tracking

> No Constitution Check violations require justification.

*(none)*
