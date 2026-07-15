# Data Model: Split-Screen Tenant Login Layout

No new tables, columns, migrations, or API endpoints. This feature is purely presentational — it
introduces no new data and changes no query (spec Key Entities). This document instead captures the
one changed component's prop shape, to confirm nothing about it needs to change.

## `TenantLoginForm` props (`apps/web/app/tenant/tenant-login-form.tsx`)

Unchanged from today:

| Prop | Type | Notes |
|---|---|---|
| `subdomain` | `string` | Used for API calls; unaffected by this feature. |
| `tenantName` | `string` | Already used for the form column's "Welcome to {tenantName}" heading; reused as-is for the new brand panel's identity display (research.md §4) — same value, one additional render site, no new prop. |
| `enabledAuthMethods` | `string[]` | Drives which fields/SSO buttons render inside the form column; entirely unchanged (spec FR-004, FR-005). |

No new props are added. No internal state (`email`, `password`, `status`, `errorMessage`,
`ssoNotice`) changes shape or behavior — only the JSX returned by the component is restructured into
two columns.

## Brand panel (new, presentation-only, no data)

The brand panel is static markup driven entirely by the existing `tenantName` prop and hardcoded
copy (research.md §4) — it has no independent data model. It reads no additional props, fetches
nothing, and holds no state.
