# Contract: `MailSender` interface

The internal contract every provider adapter implements (data-model.md `MailSender`). This is the
actual deliverable of this feature's provider-agnostic design (User Story 2) — the boundary that
lets a future provider swap touch one new file instead of the three existing call sites.

```typescript
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailSender {
  isConfigured(): boolean;
  send(message: MailMessage): Promise<void>;
}
```

## Rules an implementation MUST follow

1. `isConfigured()` MUST return `false` whenever any credential the provider needs to attempt a send
   is missing or empty — never attempt a call that's certain to fail (FR-005). MUST NOT perform a
   network call itself.
2. `send()` MUST attempt exactly one delivery per call — no internal retry (spec Out of Scope:
   retry/queueing).
3. `send()` MAY throw or reject for any failure reason (network error, non-2xx response, malformed
   response). It MUST NOT swallow failures itself — that is `mailer.ts`'s job (research.md §3), not
   the adapter's.
4. `send()` SHOULD respect a reasonable per-call timeout internally (e.g. via `AbortSignal`) as a
   resource-cleanup nicety, but MUST NOT rely on this alone — `mailer.ts`'s outer race
   (research.md §4) is the authoritative bound, not the adapter's own.
5. An implementation MUST NOT expose any provider-specific type, config shape, or env var name
   through this interface — only `MailMessage` in, `Promise<void>` out.

## Consumer contract (`mailer.ts`)

```typescript
export async function sendOneTimePasswordEmail(to: string, otp: string): Promise<void>;
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void>;
```

Unchanged signatures from today. Both MUST resolve successfully regardless of whether the underlying
`send()` succeeded, failed, or was skipped (FR-004, FR-005) — callers (the three existing call sites)
require no changes.
