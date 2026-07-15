# Contract: ZeptoMail Send Email API (external)

Reference contract for `zeptomail-sender.ts` — ZeptoMail's own API, not something this codebase
exposes (research.md §1). Documented here so the adapter and its unit tests agree on the exact shape
without re-deriving it from ZeptoMail's docs mid-implementation.

## Request

```
POST https://api.zeptomail.com/v1.1/email
Content-Type: application/json
Authorization: zoho-enczapikey <MAIL_API_TOKEN>
```

```json
{
  "from": { "address": "no-reply@example.com", "name": "TM" },
  "to": [
    { "email_address": { "address": "jordan.lee@acme.example", "name": "jordan.lee@acme.example" } }
  ],
  "subject": "Set up your TM account",
  "textbody": "Welcome to TM. Your one-time password is: ABC123\n\n..."
}
```

`to[0].email_address.name` — no separate recipient display name exists in `MailMessage`; the adapter
uses the recipient's email address for both `address` and `name`, since neither existing email type
has a stored recipient name available at the send call site today.

## Response

**2xx** — accepted for delivery:

```json
{
  "data": [{ "code": "DELIVERY_SCHEDULED", "additional_info": {}, "message": "Email sent successfully" }],
  "message": "Success",
  "request_id": "...",
  "object": "Email"
}
```

**4xx/5xx** — rejected or provider error:

```json
{
  "error": { "code": "...", "message": "...", "details": [{ "code": "...", "message": "...", "target": "..." }] },
  "request_id": "..."
}
```

`zeptomail-sender.ts`'s `send()` treats any non-2xx status as a thrown error (including the parsed
`error.message` where present, for a useful log line), and any `fetch` rejection (network failure,
`AbortSignal` timeout) the same way — `mailer.ts` does not distinguish between these failure modes
(spec Edge Cases).
