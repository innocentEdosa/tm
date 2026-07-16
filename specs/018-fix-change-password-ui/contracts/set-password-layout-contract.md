# Contract: Change Password Page Layout

This feature has no network/API contract (no backend change). The "contract" that matters here is a
UI/behavioral one: what must stay identical before and after the restructure, and what is explicitly
allowed to change.

## MUST stay byte-for-byte identical in behavior (spec FR-004, FR-005)

- The submit handler's request: `POST /tenant-api/tenant-auth/set-password?subdomain=...`, `credentials:
  "include"`, same JSON body shape (`{ newPassword }`).
- The client-side "Passwords don't match." check before submission.
- Success handling: on `204`, `router.push("/dashboard")` followed by `router.refresh()`.
- Error handling: non-`204` response → `json?.message ?? "Couldn't set your password. Try again."`;
  network failure → `"Couldn't reach the server. Try again."`.
- Field behavior: `New password` / `Confirm password` inputs, `type="password"`,
  `autoComplete="new-password"`, both `required`.
- The reassurance banner text: "You're almost in — just set your own password."
- The heading text: "Choose your password."
- The submit button text: "Continue."

## MUST NOT be introduced (spec FR-009, FR-010 — resolved via clarification)

- No back-navigation control anywhere on the page.
- No quote/testimonial card, and no card attributed to a named or photographed individual.

## MAY change (this feature's actual scope)

- `SetPasswordForm`'s prop signature: adds one new prop, `tenantName: string` (spec FR-002,
  data-model.md). `subdomain: string` is unchanged.
- `SetPasswordPage`'s header reads: adds `x-tenant-name` alongside the existing `x-tenant-subdomain`
  read. Session-check/redirect logic (`getTenantSession`, `redirect("/tenant")`) is unchanged.
- The JSX wrapper/layout structure around the form: container elements, class names, column
  arrangement (form left, decorative visual panel right), and a new wordmark render using `tenantName`.
- `apps/web/app/globals.css`: the descriptive comment above the reused `.login-split` /
  `.login-brand-panel` / `.login-brand-panel-glow` / `.login-brand-shape` / `.login-form-column` rules
  may be updated to note they now serve two pages. No rule's *behavior* changes, and no new class is
  added.

## Verification

Since there is no API contract to test against a schema, verification is behavioral: exercise every
bullet in "MUST stay byte-for-byte identical" through the new layout (quickstart.md) and confirm no
divergence from pre-change behavior, and visually confirm neither of the two "MUST NOT be introduced"
elements appears.
