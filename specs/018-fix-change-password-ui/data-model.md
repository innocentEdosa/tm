# Data Model: Split-Screen Change Password Layout

No new tables, columns, migrations, or API endpoints. This feature is purely presentational — it
changes no query and introduces no persisted data (spec Key Entities). This document instead captures
the one changed component's prop shape and the one new (already-available) data point it reads.

## `SetPasswordForm` props (`apps/web/app/set-password/set-password-form.tsx`)

| Prop | Type | Notes |
|---|---|---|
| `subdomain` | `string` | Unchanged. Used for the `set-password` API call, unaffected by this feature. |
| `tenantName` | `string` | **New.** The workspace identity string rendered as a wordmark at the top of the form column (spec FR-002). Sourced in `page.tsx` from the `x-tenant-name` request header (already set by `apps/web/middleware.ts`), falling back to `subdomain` — the identical pattern `(dashboard-shell)/layout.tsx` already uses. Not fetched from any new endpoint. |

No internal state (`newPassword`, `confirmPassword`, `status`, `errorMessage`) changes shape or
behavior — only the JSX returned by the component is restructured into two columns, plus the new
wordmark render driven by the new prop.

## `SetPasswordPage` (`apps/web/app/set-password/page.tsx`)

Adds one header read alongside the existing `x-tenant-subdomain` read:

```text
const tenantName = headerList.get("x-tenant-name") ?? subdomain;
```

Passed through to `SetPasswordForm` as the new `tenantName` prop. Session-check and redirect logic
(`getTenantSession`, `redirect("/tenant")`) is unchanged.

## Visual panel (new, presentation-only, no data)

The visual panel is fully static markup — background color plus the existing glow/shape decorative
elements reused from `017-fix-login-ui` — with no copy, no props of its own, no data dependency, and no
state (research.md §4). It does not render the `tenantName` value; that appears once, in the form
column.
