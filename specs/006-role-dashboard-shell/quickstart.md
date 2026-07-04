# Quickstart: Role-Based Dashboard Shell

Prerequisites: local Postgres + `apps/api` running (`pnpm dev` in `apps/api`), `apps/web` running
(`pnpm dev` in `apps/web`), a provisioned tenant (Spec 2) reachable at `{subdomain}.lvh.me:3000`, and
at least one real login (Spec 5) for an HR Admin account.

## Scenario 1 — HR Admin lands directly on the shell

1. Log in as the tenant's HR Admin at `http://{subdomain}.lvh.me:3000/tenant`.
2. Expect: immediate redirect to `/dashboard` — no intermediate "You're signed in" page.
3. Expect: a persistent sidebar showing Home, Team Members, Authentication Settings, and a disabled
   "Courses — Coming soon" entry.
4. Click "Team Members" — expect it opens the existing Spec 5 team-invite page, still inside the
   shell frame.

## Scenario 2 — Employee/Learner sees a reduced sidebar

1. Invite a team member with the Employee/Learner role (Spec 5's `/settings/team`), retrieve their
   OTP from the invite email (or, for local dev without SMTP, from a direct DB check as established in
   Spec 5's own manual verification), log in as them, and complete `/set-password`.
2. Expect: redirect lands on `/dashboard` directly (not `/tenant`, not an intermediate page).
3. Expect: the sidebar shows only Home and the disabled Courses entry — no Team Members or
   Authentication Settings links, since this role has neither permission.
4. Expect: the main content area shows the shared "more to come" empty state — no fabricated data.

## Scenario 3 — Missing-role defensive state (manual/DB-forced)

1. Manually delete a test user's `user_roles` row directly in Postgres (never possible through normal
   product flows — every account is created with exactly one role at provisioning or invitation).
2. Log in as that user.
3. Expect: the dashboard shell shows a clear "Your account isn't assigned a role yet" error state, not
   a blank page or a crash.

## Verifying tenant isolation

1. Log in as an HR Admin in Tenant A; note their sidebar's Team Members link works.
2. In a separate browser profile/incognito window, log in as an HR Admin in Tenant B.
3. Confirm Tenant B's shell never shows any of Tenant A's data (trivially true here, since this
   feature displays no cross-user data yet beyond the logged-in user's own session — this scenario
   exists to be re-run once real per-role content, e.g. the team roster, lands in a later spec).
