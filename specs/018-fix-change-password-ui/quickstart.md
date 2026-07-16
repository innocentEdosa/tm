# Quickstart: Split-Screen Change Password Layout

Prerequisites: `apps/api` and `apps/web` running (`pnpm dev` in each), a tenant user whose account is
flagged `mustChangePassword` (e.g. a freshly-provisioned account per the OTP-bootstrap flow, spec 005
FR-013a).

## Scenario 1 — Desktop split-screen layout

1. Sign in as a tenant user who must change their password, on a viewport ≥1024px wide. Expect a
   redirect to `/set-password`.
2. Expect: a narrower form column on the **left** (workspace name/wordmark, the "You're almost in —
   just set your own password." banner, the "Choose your password" heading, the two password fields,
   and the "Continue" button) and a wide decorative visual panel on the **right**.
3. Confirm the visual panel uses only navy/blue tones consistent with `globals.css`'s locked palette —
   no colors outside `--color-primary`/`--color-cta`.
4. Confirm the visual panel shows **no** back-arrow control and **no** quote/testimonial card (spec
   FR-009, FR-010) — it is purely decorative (background + glow/shape composition).

## Scenario 2 — Form behavior is unchanged

1. On the split-screen layout, enter two different values in "New password" and "Confirm password" and
   submit. Expect the same "Passwords don't match." error banner as before, in the same position (form
   column, above the fields).
2. Enter matching, valid passwords and submit. Expect the same redirect as before this change:
   `/dashboard`.
3. If the server rejects the request, confirm the same error banner and message logic as before
   (`json?.message ?? "Couldn't set your password. Try again."`).

## Scenario 3 — Responsive collapse

1. Resize the browser (or use device emulation) to a viewport <1024px wide.
2. Expect the visual panel to disappear entirely and the password form to expand to the page's full
   width, centered — matching the page's pre-change single-column presentation.
3. Confirm no horizontal scrollbar appears at any width from ~320px up to the 1024px breakpoint.

## Scenario 4 — Long tenant name

1. Using a tenant with an unusually long name (or temporarily renaming one in a dev environment), reach
   `/set-password` as a user of that tenant.
2. Confirm the form column's workspace wordmark truncates or wraps without breaking the layout or
   causing overflow.

## Verifying no functional regression

This feature only restyles the change-password page — re-run the relevant scenarios from the Tenant
Authentication Configuration spec's (005) quickstart (OTP-bootstrap forced password change,
successful redirect to `/dashboard`) through the new layout to confirm the previously-working flow still
works end-to-end.
