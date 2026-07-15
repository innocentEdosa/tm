# Phase 0 Research: Email API Mailer

## §1. ZeptoMail's API contract

**Decision**: `POST https://api.zeptomail.com/v1.1/email`, header `Authorization: zoho-enczapikey
<send-mail-token>`, JSON body:

```json
{
  "from": { "address": "sender@example.com", "name": "Sender Name" },
  "to": [{ "email_address": { "address": "recipient@example.com", "name": "Recipient Name" } }],
  "subject": "…",
  "textbody": "…"
}
```

A 2xx response body has the shape `{ "data": [...], "message": "Success", "request_id": "...",
"object": "Email" }`; a 4xx/5xx error response has `{ "error": { "code": "...", "message": "...",
"details": [...] }, "request_id": "..." }`. Confirmed against ZeptoMail's own published API
documentation (source below), not assumed.

**Rationale**: This is the exact, current contract — needed to write `zeptomail-sender.ts` and its
test doubles correctly on the first attempt rather than discovering the real shape during
implementation.

**Alternatives considered**: N/A — this is a fixed external contract, not a design choice.

Source: [Send Transactional Emails with API | ZeptoMail](https://www.zoho.com/zeptomail/help/api/email-sending.html)

## §2. No new dependency — `fetch` covers ZeptoMail's contract

**Decision**: Call ZeptoMail directly with Node 20's global `fetch`; do not install the `zeptomail`
npm package.

**Rationale**: The entire contract (research.md §1) is one JSON `POST` with one auth header and a
JSON body — exactly what `fetch` already expresses with no wrapper needed. Constitution Principle
XII requires checking whether a built-in covers the need before reaching for a package; here it
plainly does.

**Alternatives considered**: The official `zeptomail` SDK (confirmed to exist on npm) was considered
and rejected — it would add a maintained-by-a-third-party supply-chain dependency for a request shape
that needs no abstraction beyond a single typed function. Per Principle XIII, installing it would
also require explicit sign-off this plan doesn't have and doesn't need to ask for, since the built-in
path is sufficient.

## §3. Where the cross-cutting guarantees live: `mailer.ts`, not each adapter

**Decision**: `MailSender` is a two-method interface — `isConfigured(): boolean` and
`send(message: MailMessage): Promise<void>` (the latter is allowed to throw on any failure — network
error, non-2xx, malformed response). `mailer.ts` owns the *only* copy of the skip-when-unconfigured
check, the bounded-timeout race, and the catch-and-log-never-rethrow wrapper, applied uniformly
around whichever `MailSender` is currently wired in.

**Rationale**: Spec User Story 2, Acceptance Scenario 2 requires the non-blocking and
skip-when-unconfigured guarantees to hold "regardless of which adapter is active." Putting those
guarantees inside each adapter would mean re-implementing (and risking a future author forgetting to
re-implement) them on every provider swap — the one thing this spec explicitly wants to make cheap.
Centralizing them in `mailer.ts` means a future adapter can be as minimal as "does `isConfigured()`
return correctly, does `send()` either resolve or throw" — the safety properties are structural, not
a matter of adapter-author diligence.

**Alternatives considered**: A design where each adapter is fully self-contained (owns its own
timeout, its own configured-check, its own error swallowing) was considered and rejected — it
satisfies FR-004/FR-005 for ZeptoMail specifically, but not "regardless of which adapter is active"
(User Story 2 AS2), since nothing would enforce a future adapter re-implementing the same guarantees
correctly.

## §4. Timeout mechanism: `Promise.race` in `mailer.ts` (authoritative) + `AbortSignal` in the adapter (defense-in-depth)

**Decision**: `mailer.ts`'s wrapper races `sender.send(message)` against a timer promise (chosen
budget: 3000ms) and treats a timeout the same as any other failure — logged, swallowed, never
propagated. Additionally, `zeptomail-sender.ts`'s `fetch` call passes `signal:
AbortSignal.timeout(3000)` so a timed-out attempt also stops the underlying in-flight request rather
than leaking it in the background.

**Rationale**: The `Promise.race` in `mailer.ts` is the guarantee that actually matters (research.md
§3 — it must hold for any adapter, including a hypothetical future one that forgets to bound its own
network calls). The adapter-level `AbortSignal` is a resource-cleanup nicety specific to `fetch`-based
adapters, not something every future adapter is required to have for the spec's guarantee to hold.

**Alternatives considered**: Relying solely on `AbortSignal.timeout()` inside the adapter (no outer
race) was considered and rejected — it would make the timeout guarantee adapter-specific again,
contradicting research.md §3's rationale. 3000ms (vs. the old SMTP transport's 1500ms
`connectionTimeout`/`socketTimeout`) was chosen as a single-request HTTPS round trip's reasonable
budget — not spec-mandated, informative default only, adjustable in code review without a spec change.

## §5. Configuration: provider-agnostic env var names

**Decision**: Four new env vars — `MAIL_API_TOKEN` (required for `isConfigured()` to return true),
`MAIL_FROM_EMAIL` (required, must already be a verified sender identity in the ZeptoMail account),
`MAIL_FROM_NAME` (optional, defaults to `"TM"`), `MAIL_API_URL` (optional, defaults to ZeptoMail's
global endpoint `https://api.zeptomail.com/v1.1/email` — overridable for a region-specific ZeptoMail
account, e.g. the EU endpoint, without a code change). The previous `SMTP_HOST`/`SMTP_PORT`/
`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` are removed from `.env.example` and read nowhere.

**Rationale**: FR-007 requires every env var read outside the ZeptoMail adapter itself to be
provider-agnostic. `MAIL_API_TOKEN`/`MAIL_FROM_EMAIL`/`MAIL_FROM_NAME` are read by
`zeptomail-sender.ts` alone (the adapter's own `isConfigured()`), so `mailer.ts` never references
anything ZeptoMail-specific — a future adapter reads whatever credential shape its own provider
needs, under the same or new provider-agnostic names, without touching `mailer.ts`.

**Alternatives considered**: Naming the token variable `ZEPTOMAIL_API_TOKEN` (provider-specific) was
considered and rejected outright — it directly contradicts FR-007 and User Story 3's explicit
"env-var churn on every swap" complaint from the stakeholder.

## §6. Testing without a real ZeptoMail account

**Decision**: `apps/api/tests/unit/zeptomail-sender.test.ts` mocks `global.fetch` via Vitest's
`vi.stubGlobal("fetch", ...)`, asserting the adapter sends the exact request shape from research.md
§1 and correctly resolves/throws for a mocked 2xx/4xx/5xx/network-error response.
`apps/api/tests/unit/mailer.test.ts` uses a hand-written fake `MailSender` (not ZeptoMail-specific) to
prove `mailer.ts`'s wrapper guarantees (skip-when-unconfigured, non-blocking on throw, non-blocking
on a sender that never resolves) independent of any real provider. Neither test file touches
Postgres or the network.

**Rationale**: This codebase has zero existing precedent for mocking `fetch` (every prior spec's
external-ish integration — SMTP via `nodemailer`, subdomain routing, RLS — either has a real local
service to test against, like Postgres, or is itself the thing under test). ZeptoMail has no
Mailtrap-equivalent public sandbox mode documented, and requiring a real API token in CI would make
the test suite depend on a live third-party account and network access — unacceptable for a unit-level
test of request-construction logic. `apps/api/tests/unit/` (currently holding one file,
`effective-permissions.test.ts`) is exactly the existing convention for this shape of test: pure
logic, no DB, no server.

**Alternatives considered**: Testing only at the integration level (exercising the three call sites
end-to-end, as `provision-tenant-otp-email.test.ts` already does) was considered as the *sole*
coverage and rejected as insufficient on its own — those tests only exercise the skip-when-unconfigured
path (no real credentials in CI) and would never catch a malformed ZeptoMail request shape; they
remain valuable as-is (proving the non-blocking guarantee end-to-end) but are complementary to, not a
replacement for, the new unit tests.

## §7. New dependencies

**Decision**: None.

**Rationale**: Every piece of infrastructure this feature needs — `fetch`, `AbortSignal.timeout()`,
Vitest, `vi.stubGlobal` — is already available in Node 20 / the existing dev-dependency set, with no
installation required (research.md §1–§2, §6).
