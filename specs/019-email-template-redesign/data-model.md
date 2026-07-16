# Phase 1 Data Model: Transactional Email Template Redesign

No database schema changes. This feature's "entities" (per spec.md Key Entities) are in-memory
TypeScript shapes passed between the route handlers, the template builders, and the mail transport —
documented here for the shapes that change or are newly introduced.

## `MailMessage` (modified)

`apps/api/src/mail/mail-sender.ts` — the provider-agnostic payload every `MailSender` implementation
accepts. Adds one field; nothing else about the interface changes.

```typescript
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string; // NEW
}
```

- `html` MUST be a complete, self-contained HTML fragment (no external `<link>`/`<script>` the
  recipient's client would need to fetch) — research.md §4.
- `text` MUST continue to carry every fact `html` does (spec FR-005) — the two are generated together
  by the same template builder, never independently.

## `TenantCreationEmailContent` (new, input to the builder — not persisted)

Backing spec User Story 1 / FR-001 / FR-006.

| Field | Type | Source |
|---|---|---|
| `loginEmail` | `string` | The `to` value at the call site (`createdAdmin.email`) — see research.md §7 |
| `tenantName` | `string` | `createdTenant.name`, already in scope in `provision-tenant.ts` |
| `oneTimePassword` | `string` | The generated OTP, already in scope |
| `otpValidityHours` | `number` | Constant, `72` (research.md §9) |

## `MemberInviteEmailContent` (new, input to the builder — not persisted)

Backing spec User Story 2 / FR-002.

| Field | Type | Source |
|---|---|---|
| `loginEmail` | `string` | The `to` value at the call site (`createdUser.email`) |
| `tenantName` | `string` | New read added in `tenant-team-routes.ts` (research.md §6) |
| `oneTimePassword` | `string` | The generated OTP, already in scope |
| `otpValidityHours` | `number` | Constant, `72` |

## `PasswordResetEmailContent` (new, input to the builder — not persisted)

Backing spec User Story 3 / FR-004.

| Field | Type | Source |
|---|---|---|
| `resetLink` | `string` | Already-built `resetLink` value in `tenant-auth-routes.ts` |
| `linkValidityHours` | `number` | Constant, `1` (research.md §8) |

## `EmailTemplateResult` (new — the builder's return shape)

The output every builder function in `email-templates.ts` returns; `mailer.ts` passes it straight
through into a `MailMessage` (plus `to`).

```typescript
interface EmailTemplateResult {
  subject: string;
  text: string;
  html: string;
}
```

## Validation / rendering rules

- Any interpolated tenant- or user-supplied string (`tenantName`, and any future full-name field)
  MUST pass through the local `escapeHtml()` helper before being placed inside `html` — spec FR-007.
  `text` needs no escaping (plain text has no markup to break).
- No field above introduces a new persisted column or table; all values already exist in each
  route's transaction scope except `tenantName` in the member-invite path, which is a read of an
  existing column (`tenants.name`) already defined in `apps/api/src/db/schema/tenants.ts`.
