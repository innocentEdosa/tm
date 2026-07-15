# Contract: Tenant Login Page Layout

This feature has no network/API contract (no backend change). The "contract" that matters here is a
UI/behavioral one: what must stay identical before and after the restructure, and what is explicitly
allowed to change.

## MUST stay byte-for-byte identical in behavior (spec FR-004, FR-005)

- `TenantLoginForm`'s exported prop signature: `{ subdomain: string; tenantName: string;
  enabledAuthMethods: string[] }`.
- The condition under which the email/password fields render: `enabledAuthMethods.includes("email_password")`.
- The condition under which SSO buttons render: `enabledAuthMethods.filter((m) => m !== "email_password")`.
- The submit handler's request: `POST /tenant-api/tenant-auth/login?subdomain=...`, `credentials:
  "include"`, same JSON body shape (`{ email, password }`).
- Redirect targets on success: `/set-password` if `mustChangePassword`, else `/dashboard`, followed by
  `router.refresh()`.
- Error handling: `429` → rate-limit message; other non-200 → `json?.message ?? "Invalid email or
  password."`; network failure → `"Couldn't reach the login service. Try again."`.
- The "Forgot password?" link's `href="/forgot-password"`.
- The no-method-configured message and its trigger condition (`!showEmailPassword && ssoMethods.length === 0`).
- The SSO "not available yet" notice text and trigger (`setSsoNotice` on click).

## MAY change (this feature's actual scope)

- The JSX wrapper/layout structure around the above: container elements, class names, column
  arrangement, and the addition of the new brand panel markup.
- `apps/web/app/globals.css`: new CSS classes may be added for the split-screen wrapper and brand
  panel. No existing class's *behavior* changes (e.g. `.field-input`, `.btn-primary`, `.banner-error`
  keep their current definitions, reused as-is inside the new layout).

## Verification

Since there is no API contract to test against a schema, verification is behavioral: exercise every
bullet in "MUST stay byte-for-byte identical" through the new layout (quickstart.md) and confirm no
divergence from pre-change behavior.
