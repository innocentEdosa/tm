# Quickstart: Split-Screen Tenant Login Layout

Prerequisites: `apps/api` and `apps/web` running (`pnpm dev` in each), a tenant already provisioned
with at least one enabled auth method (from prior specs' quickstarts, e.g. 005-tenant-auth-config).

## Scenario 1 — Desktop split-screen layout

1. Visit a valid tenant subdomain's root URL (`/tenant`, or the tenant's actual subdomain host) while
   signed out, on a viewport ≥1024px wide.
2. Expect: a wide brand panel on the **left** (tenant name/wordmark, a headline, a supporting
   sentence, and a decorative graphic filling the lower area) and the login form in a narrower column
   on the **right**.
3. Confirm the brand panel uses only navy/blue tones consistent with `globals.css`'s locked palette —
   no colors outside `--color-primary`/`--color-cta`/`--color-surface`/`--color-border`.

## Scenario 2 — Form behavior is unchanged

1. On the split-screen layout, enter valid credentials and submit.
2. Expect the same redirect as before this change: `/set-password` if a password change is required,
   otherwise `/dashboard`.
3. Repeat with invalid credentials — expect the same error banner, same wording, same placement
   (inside the right-hand form column, above the fields).
4. If the tenant has SSO methods enabled, confirm the "or" divider and SSO buttons render in the form
   column in the same order as before, and clicking one shows the same "isn't available yet" notice.
5. If the tenant has zero enabled auth methods, confirm the "No login method is currently configured"
   message renders in the form column, brand panel unaffected.

## Scenario 3 — Responsive collapse

1. Resize the browser (or use device emulation) to a viewport <1024px wide.
2. Expect the brand panel to disappear entirely and the login form to expand to the page's full width,
   centered — matching the page's pre-change single-column presentation.
3. Confirm no horizontal scrollbar appears at any width from ~320px up to the 1024px breakpoint.

## Scenario 4 — Long tenant name

1. Using a tenant with an unusually long name (or temporarily renaming one in a dev environment),
   reload the login page.
2. Confirm both the brand panel's identity text and the form column's "Welcome to {tenantName}"
   heading truncate or wrap without breaking the layout or causing overflow.

## Verifying no functional regression

This feature only restyles the tenant login page — re-run the Tenant Authentication Configuration
spec's (005) own quickstart scenarios (email/password login, SSO placeholder, rate-limiting,
must-change-password redirect) through the new layout to confirm every previously-working flow still
works end-to-end.
