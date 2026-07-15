# Data Model: Email API Mailer

No database table, migration, or RLS policy is touched by this feature (Constitution Alignment:
N/A for tenant-isolation model). The "entities" here are TypeScript types/interfaces — the internal
contract this feature introduces — not persisted data.

## Types

### `MailMessage` — what any call site asks to have sent

| Field | Type | Notes |
|---|---|---|
| `to` | `string` | Recipient email address. |
| `subject` | `string` | Unchanged from today's hardcoded subject lines in `mailer.ts`. |
| `text` | `string` | Plain-text body. Unchanged from today's hardcoded body text (spec: content is not part of this change). |

### `MailSender` — the provider-agnostic interface every adapter implements

| Member | Signature | Notes |
|---|---|---|
| `isConfigured` | `(): boolean` | Adapter-owned check for whether *this* provider has everything it needs (e.g. ZeptoMail: an API token and a from-address). `mailer.ts` calls this before ever calling `send` — FR-005's "no network call attempted" guarantee lives here. |
| `send` | `(message: MailMessage): Promise<void>` | Performs the actual delivery attempt. Allowed to throw/reject for any failure (network error, non-2xx, timeout) — `mailer.ts`'s wrapper is solely responsible for catching it (research.md §3), not the adapter. |

**State/lifecycle**: Stateless — no persisted state, no session, one call per email. `mailer.ts` holds
exactly one active `MailSender` at a time, resolved at module load (research.md §3); switching
providers means changing which concrete implementation is imported and assigned there.

### ZeptoMail request/response mapping (`zeptomail-sender.ts` internals, not part of the public interface)

Maps a `MailMessage` to ZeptoMail's request body (research.md §1):

| `MailMessage` field | ZeptoMail request field |
|---|---|
| (config: `MAIL_FROM_EMAIL`) | `from.address` |
| (config: `MAIL_FROM_NAME`, default `"TM"`) | `from.name` |
| `to` | `to[0].email_address.address` |
| `subject` | `subject` |
| `text` | `textbody` |

A 2xx response resolves `send()`; a non-2xx response (parsed `error.message` where present) or a
`fetch` rejection (network error, `AbortSignal` timeout) throws, with the underlying reason attached
so `mailer.ts`'s `console.error` log line is useful for debugging (FR-009).

## Configuration

| Env var | Required | Read by | Notes |
|---|---|---|---|
| `MAIL_API_TOKEN` | Yes (for `isConfigured()` to be true) | `zeptomail-sender.ts` only | ZeptoMail "send mail" token, sent as `Authorization: zoho-enczapikey <token>`. |
| `MAIL_FROM_EMAIL` | Yes (for `isConfigured()` to be true) | `zeptomail-sender.ts` only | Must already be a verified sender identity in the ZeptoMail account (spec Assumptions) — this code does not provision that verification. |
| `MAIL_FROM_NAME` | No — defaults to `"TM"` | `zeptomail-sender.ts` only | Display name on outgoing email. |
| `MAIL_API_URL` | No — defaults to `https://api.zeptomail.com/v1.1/email` | `zeptomail-sender.ts` only | Override point for a region-specific ZeptoMail account (e.g. an EU endpoint) without a code change. |

No env var above is read by `mailer.ts` or any of the three call sites — only by
`zeptomail-sender.ts` (FR-007, research.md §5). Removed entirely: `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
