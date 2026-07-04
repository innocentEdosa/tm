---

description: "Task list for implementing the Tenant Authentication Configuration feature"
---

# Tasks: Tenant Authentication Configuration

**Input**: Design documents from `/specs/005-tenant-auth-config/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/ (`tenant-auth-api.md`, `nextjs-tenant-auth-pages.md`), quickstart.md

**Tests**: Included on the `apps/api` side — this is a security-critical spec (credential hashing,
session/tenant isolation, rate-limiting, enumeration protection), matching Specs 3–4's precedent of
proving these mechanisms against real Postgres, no mocks. **Not included** on the `apps/web` side —
no test runner exists there today, unchanged decision from Spec 4 (research.md §6 there); this
feature's new pages are verified via `quickstart.md`'s manual/browser scenarios instead.

**Dependency sign-off status**: One new package this time — `nodemailer` (+ `@types/nodemailer`) —
explicitly confirmed by the user (2026-07-04, SMTP over an existing mailbox, not a transactional
email API). T001 performs the actual install; no other task in this list should run `pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US6); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Confirm sign-off (already obtained, plan.md Technical Context) and run
  `pnpm add nodemailer && pnpm add -D @types/nodemailer` in `apps/api`. This is the only install
  command in this entire task list. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, migrations, the reusable auth primitives (OTP generation, cookies, mailer),
the session-context plugin + guard, and the Spec 4 amendment every user story depends on.
**Nothing in Phase 3+ can start until this phase is complete.**

- [X] T002 [P] Amend `apps/api/src/db/schema/users.ts`: add `passwordHash` (text, nullable),
  `mustChangePassword` (boolean, not null, default `false`), `otpExpiresAt` (timestamptz, nullable),
  `failedLoginCount` (integer, not null, default `0`), `lockedUntil` (timestamptz, nullable) per
  data-model.md `users`. (Backend-only)
- [X] T003 [P] Create `apps/api/src/db/schema/tenant-auth-methods.ts`: `tenantAuthMethods` table
  (`id`, `tenantId`, `method` with a `CHECK` constraint on the four values, `enabledAt`),
  `UNIQUE(tenant_id, method)` per data-model.md `tenant_auth_methods`. (Backend-only)
- [X] T004 [P] Create `apps/api/src/db/schema/user-sessions.ts`: `userSessions` table (`id`,
  `tenantId`, `userId`, `tokenHash` unique, `createdAt`, `expiresAt`, `revokedAt`) per data-model.md
  `user_sessions`. (Backend-only)
- [X] T005 [P] Create `apps/api/src/db/schema/password-reset-tokens.ts`: `passwordResetTokens` table
  (`id`, `tenantId`, `userId`, `tokenHash` unique, `createdAt`, `expiresAt`, `usedAt`) per
  data-model.md `password_reset_tokens`. (Backend-only)
- [X] T006 Generate the Drizzle migration from T002–T005 via `drizzle-kit generate`. Depends on
  T002, T003, T004, T005. (Backend-only)
- [X] T007 Author the RLS migration for the three new tables (hand-authored SQL, matching the
  `000{2,3,4}`/`00{9,10,11}_rls_*.sql` precedent): `ENABLE`/`FORCE ROW LEVEL SECURITY` plus the
  *standard* `tenant_isolation` policy shape (`USING/WITH CHECK tenant_id =
  current_setting('app.tenant_id', true)::uuid`) on `tenant_auth_methods`, `user_sessions`,
  `password_reset_tokens` — no narrow allowance-clause policy needed here (research.md §3, §5).
  Depends on T006. (Backend-only)
- [X] T008 Author the grants migration: `tm_app` gets full `SELECT/INSERT/UPDATE/DELETE` on the
  three new tables (`users`' existing grant from `0012_lock_department_catalog_grants.sql` already
  covers the new columns from T002). Depends on T007. (Backend-only)
- [X] T009 Author the permission-seed migration: seed `manage_authentication_settings` and
  `manage_team_members` permissions; grant both to the `hr_admin` role template (future
  provisioning) *and* retroactively to every existing tenant's already-live `hr_admin`-sourced
  `roles` row (mirroring `0014_seed_provision_tenant_permission.sql`'s backfill pattern,
  research.md §7). Depends on T006. (Backend-only)
- [X] T010 Author the `tenant_auth_methods` backfill migration: `INSERT ... SELECT id,
  'email_password' FROM tenants ON CONFLICT DO NOTHING` for every existing tenant (research.md §7's
  sibling backfill). Depends on T007. (Backend-only)
- [X] T011 [P] Implement `apps/api/src/tenant-auth/otp.ts`: `generateOneTimePassword()` via
  `crypto.randomBytes`, URL-safe encoded (research.md §6). (Backend-only)
- [X] T012 [P] Implement `apps/api/src/tenant-auth/cookies.ts`: `TENANT_USER_COOKIE_NAME =
  "tm_tenant_session"`, `serializeTenantUserCookie(value, maxAgeSeconds)` — `HttpOnly`, `Secure`
  omitted when `NODE_ENV === "development"` (the dev-safe pattern already fixed in
  `platform-auth/cookies.ts`), `SameSite=Strict`, `Path=/`, **no `Domain` attribute** (host-only
  scoping, plan.md Constraints). Imports and reuses `parseCookie` from `platform-auth/cookies.ts`
  rather than duplicating it (research.md §1). (Backend-only)
- [X] T013 [P] Implement `apps/api/src/tenant-auth/mailer.ts`: a `nodemailer` SMTP transport built
  from `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` env vars, with
  `sendOneTimePasswordEmail(to, otp)` and `sendPasswordResetEmail(to, resetLink)` functions. Depends
  on T001. (Backend-only)
- [X] T014 Implement `apps/api/src/tenant-auth/tenant-user-context.ts`: a Fastify plugin mirroring
  `tenant-context.ts`/`super-admin-context.ts`'s `onRequest`-hook idiom. Reads `subdomain` from
  `request.query` (never the body — research.md §4 addendum), calls Spec 4's
  `resolveTenantBySubdomain` to independently get the real `tenant_id`; if `state !== "valid"`,
  skips (no session decoration). Otherwise reads the `tm_tenant_session` cookie (T012), hashes it,
  opens a dedicated transaction, `SELECT set_config('app.tenant_id', $resolvedTenantId, true)`,
  looks up `user_sessions` by `token_hash` where `revoked_at IS NULL AND expires_at > now()` (the
  *standard* RLS policy from T007 makes a session from a different tenant structurally invisible —
  research.md §3); if found, decorates `request.user = { id: session.userId, tenantId:
  resolvedTenantId }` and `request.mustChangePassword` from the joined `users` row. Depends on T004,
  T007, T012. (Backend-only)
- [X] T015 Implement `apps/api/src/tenant-auth/require-tenant-user-session.ts`: a `preHandler`
  replying `401` if `request.user` is not set. Depends on T014. (Backend-only)
- [X] T016 Register `tenant-user-context` in `apps/api/src/server.ts` **before**
  `tenantContext` (so `request.user` is decorated before `tenant-context.ts` reads it — same
  ordering constraint the existing dev-only header stub already respects). Depends on T014.
  (Backend-only)
- [X] T017 Amend `apps/api/src/tenant-routing/resolve-tenant.ts` (Spec 4): when `state === "valid"`,
  additionally query `tenant_auth_methods` for the resolved tenant and include
  `enabledAuthMethods: string[]` in the returned result (plan.md Complexity Tracking — additive
  field, no new endpoint). Depends on T003, T007. (Backend-only)
- [X] T018 [P] Amend `apps/web/next.config.ts`: add `{ source: "/tenant-api/:path*", destination:
  \`${API_ORIGIN}/:path*\` }` to the existing `rewrites()` array, alongside `/platform-api/*`.
  (Backend-only)
- [X] T019 [P] Write `apps/api/tests/integration/tenant-user-session-rls-mechanism.test.ts`: seed
  two tenants and one `user_sessions` row per tenant directly via SQL fixture; confirm a session
  looked up under tenant A's resolved `app.tenant_id` never returns tenant B's row, proving the
  *standard* `tenant_isolation` policy alone is sufficient for session isolation (research.md §3) —
  no special mechanism to additionally verify, unlike Spec 4's narrow-allowance policy test. Depends
  on T007. (Backend-only)

**Checkpoint**: Schema, migrations, OTP/cookie/mailer primitives, the session-context plugin +
guard, and Spec 4's amendment all exist and are proven (T019). User story phases can now begin.

---

## Phase 3: User Story 1 - HR Admin Configures the Tenant's Login Method (Priority: P1)

**Goal**: A newly provisioned tenant has a sensible default method enabled automatically; an HR
Admin can view and change enabled methods afterward, with at least one always required.

**Independent Test**: Provision a tenant, confirm email/password is enabled by default; as HR
Admin, enable a second method and confirm both remain enabled; attempt to disable down to zero and
confirm it's rejected.

- [X] T020 [US1] Amend `apps/api/src/provisioning/provision-tenant.ts` (Spec 2): within the same
  provisioning transaction, insert a `tenant_auth_methods` row (`method: 'email_password'`) for the
  new tenant (spec FR-003). Same file as Spec 4's reserved-word check, sequential; also touched
  again by US5 (T046) later. Depends on T003, T007. (Backend-only)
- [X] T021 [US1] Implement `GET`/`PUT /tenant-auth/settings/methods` in new
  `apps/api/src/tenant-auth/tenant-auth-settings-routes.ts`: both guarded by
  `require-tenant-user-session` (T015) plus a `manage_authentication_settings` permission check
  (`requirePermission`, Spec 1, unchanged); `PUT` replaces the enabled-methods set and rejects
  (`409`) a result that would leave zero methods enabled (FR-006). Depends on T015, T003. (Backend-only)
- [X] T022 [US1] Register `tenant-auth-settings-routes` in `apps/api/src/server.ts`. Depends on
  T021. (Backend-only)
- [X] T023 [P] [US1] Write `apps/api/tests/integration/provision-tenant-default-auth-method.test.ts`:
  a newly provisioned tenant has exactly one `tenant_auth_methods` row (`email_password`) with no
  manual step (FR-003, US1 AS1). Depends on T020. (Backend-only)
- [X] T024 [P] [US1] Write `apps/api/tests/integration/tenant-auth-settings-multi-enable.test.ts`:
  `PUT` can enable a second method without disabling the first; both appear on a subsequent `GET`
  (FR-002, US1 AS4). Depends on T022. (Backend-only)
- [X] T025 [P] [US1] Write `apps/api/tests/integration/tenant-auth-settings-min-one.test.ts`:
  attempting to `PUT` a set that would leave zero enabled methods is rejected with `409`, and the
  previously enabled method remains untouched (FR-006, US1 AS3). Depends on T022. (Backend-only)
- [X] T026 [US1] **Frontend — needs UI-UX-Pro-Max skill.** Build
  `apps/web/app/settings/authentication/page.tsx`: requires an active session with
  `manage_authentication_settings` (a `403` from the backend surfaces as an in-page message,
  mirroring `apps/web/app/admin/permissions/page.tsx`'s existing pattern); toggles enabled methods,
  `PUT`s the full set to `/tenant-api/settings/methods?subdomain=...`, client-side blocks
  submitting zero methods as a first line of defense. Depends on T022. Extended again by US6 (T054)
  to also toggle the three SSO methods.

**Checkpoint**: US1 complete and independently demoable.

---

## Phase 4: User Story 2 - Employee Logs In With Email and Password (Priority: P1)

**Goal**: Full, secure email/password login: correct credentials issue a tenant-scoped session;
wrong password and unknown email are indistinguishable; repeated failures are rate-limited; a
session never crosses tenants.

**Independent Test**: Seed a user with a known password hash directly via SQL fixture (sidesteps
the OTP flow, which is US5's concern), submit correct credentials at that tenant's login endpoint,
confirm a tenant-scoped session is issued.

- [X] T027 [US2] Implement `POST /tenant-auth/login` in new
  `apps/api/src/tenant-auth/tenant-auth-routes.ts`: resolves `tenant_id` from the `subdomain` query
  param via `resolveTenantBySubdomain` (never trusted directly); looks up the user by email under
  that tenant; if not found, runs a dummy `verifyPassword` against `DUMMY_PASSWORD_HASH`
  (`platform-auth/password.ts`, reused) before replying `401` (FR-009 enumeration protection); if
  `locked_until` is in the future, replies `429`; verifies the password (or still-valid OTP — same
  `verifyPassword` call, research.md §6) via `verifyPassword`; on failure, increments
  `failed_login_count`, sets `locked_until` once the threshold is reached (FR-010); on success,
  issues a session (T011's token helpers reused from `platform-auth/session.ts`), sets the
  `tm_tenant_session` cookie (T012), resets `failed_login_count`, returns
  `{ id, email, mustChangePassword }`. Depends on T012, T014. (Backend-only)
- [X] T028 [US2] Implement `GET /tenant-auth/me` in the same file, guarded by
  `require-tenant-user-session` (T015): returns `{ id, email, mustChangePassword }`. Same file,
  sequential. Depends on T027. (Backend-only)
- [X] T029 [US2] Implement `POST /tenant-auth/logout` in the same file, guarded by
  `require-tenant-user-session`: revokes the session, clears the cookie. Same file, sequential.
  Depends on T028. (Backend-only)
- [X] T030 [US2] Register `tenant-auth-routes` in `apps/api/src/server.ts`. Depends on T029.
  (Backend-only)
- [X] T031 [P] [US2] Write `apps/api/tests/integration/tenant-auth-login-success.test.ts`: seed a
  user directly via SQL fixture with a real `password_hash` (bypassing OTP intentionally, to keep
  this story independently testable); valid credentials return `200` with a session cookie scoped
  to that tenant's `tenant_id` (FR-011, US2 AS1). Depends on T030. (Backend-only)
- [X] T032 [P] [US2] Write `apps/api/tests/integration/tenant-auth-login-no-enumeration.test.ts`: a
  wrong password for a real seeded email and a login attempt for a nonexistent email return
  byte-identical response bodies and status (FR-009, US2 AS2). Depends on T030. (Backend-only)
- [X] T033 [P] [US2] Write `apps/api/tests/integration/tenant-auth-login-rate-limit.test.ts`: 5
  consecutive failures lock the account out; a 6th attempt with the *correct* password still
  returns `429` until the lockout window elapses (FR-010, US2 AS3). Depends on T030. (Backend-only)
- [X] T034 [P] [US2] Write `apps/api/tests/integration/tenant-auth-cross-tenant-session.test.ts`: a
  session obtained by logging in at tenant A's subdomain is rejected (`401`, via `GET
  /tenant-auth/me`) when the same cookie is presented with `subdomain` resolved to tenant B (FR-012,
  US2 AS4) — the concrete proof of research.md §3's RLS-only isolation claim, using real login
  flows rather than raw fixtures this time. Depends on T030. (Backend-only)

**Checkpoint**: US2 complete — the MVP. Note: while US1 is listed first per spec priority order,
US2's own login flow is what genuinely proves the tenant-isolation design end-to-end; consider it
the practical MVP checkpoint even though US1 is phase-numbered first.

---

## Phase 5: User Story 3 - Login Page Shows Only What's Configured (Priority: P2)

**Goal**: The tenant login page renders exactly the enabled method(s) for that tenant — proven
across single- and multi-method configurations.

**Independent Test**: Configure two tenants differently, visit both login pages, confirm each shows
exactly its own configured method(s).

- [X] T035 [P] [US3] Write `apps/api/tests/integration/tenant-routing-resolve-auth-methods.test.ts`:
  the (Spec 4, amended) resolve endpoint returns `enabledAuthMethods` matching exactly what's
  configured for two differently-configured tenants — never leaking one tenant's methods into the
  other's response (FR-007, US3 AS1/AS2). Depends on T017. (Backend-only)
- [X] T036 [US3] **Frontend — needs UI-UX-Pro-Max skill.** Amend `apps/web/app/tenant/page.tsx`
  (Spec 4's placeholder): the unauthenticated branch calls the resolve endpoint for
  `enabledAuthMethods` and renders only those methods — an email/password form if enabled, a
  (stubbed, per US6) button per enabled SSO method, laid out clearly when more than one is present
  (US3 AS3). The authenticated branch (valid, non-`mustChangePassword` session) renders a minimal
  confirmation, mirroring Spec 3's `/platform` pattern — no full dashboard (spec Assumptions).
  Depends on T017, T028.

**Checkpoint**: US3 complete.

---

## Phase 6: User Story 4 - User Resets a Forgotten Password (Priority: P2)

**Goal**: A user can request and complete a password reset via a time-limited, single-use link,
without revealing whether an email has an account.

**Independent Test**: Request a reset for a real account, complete it with the issued token,
confirm the old password stops working and the new one succeeds.

- [X] T037 [US4] Implement `POST /tenant-auth/forgot-password` in
  `apps/api/src/tenant-auth/tenant-auth-routes.ts` (same file as US2, sequential): resolves tenant
  from `subdomain`; if the email has an account, issues a `password_reset_tokens` row and calls
  `sendPasswordResetEmail` (T013); returns an identical `200` either way (FR-015). Depends on T029.
  (Backend-only)
- [X] T038 [US4] Implement `POST /tenant-auth/reset-password` in the same file: validates the token
  (not already used, not expired — `409`/`401` if so), sets the new password hash, marks the token
  used; does **not** touch `must_change_password` (FR-014, distinct from the OTP path). Same file,
  sequential. Depends on T037. (Backend-only)
- [X] T039 [P] [US4] Write `apps/api/tests/integration/tenant-auth-reset-single-use.test.ts`: a
  reset token works once; reusing it is rejected (FR-014, US4 AS2). Depends on T038. (Backend-only)
- [X] T040 [P] [US4] Write `apps/api/tests/integration/tenant-auth-forgot-no-enumeration.test.ts`:
  requesting a reset for a real account vs. a nonexistent email at the same tenant return identical
  responses (FR-015, US4 AS3). Depends on T038. (Backend-only)
- [X] T041 [US4] **Frontend — needs UI-UX-Pro-Max skill.** Build
  `apps/web/app/forgot-password/page.tsx`: reads the subdomain (same threading pattern as
  `/tenant`), submits to `/tenant-api/forgot-password?subdomain=...`, always shows the same generic
  confirmation. Depends on T037.
- [X] T042 [US4] **Frontend — needs UI-UX-Pro-Max skill.** Build
  `apps/web/app/reset-password/page.tsx`: reads a `token` query param plus the subdomain, submits
  to `/tenant-api/reset-password?subdomain=...`. Depends on T038.

**Checkpoint**: US4 complete.

---

## Phase 7: User Story 5 - New Admins and Team Members Get a Working Login Without Manual Setup (Priority: P2)

**Goal**: Both the initial provisioning admin and any team member added afterward receive a
one-time password by email and are forced to set a real password before reaching anything else.

**Independent Test**: Provision a tenant, confirm the admin's OTP email arrives and that logging in
with it forces a password change before anything else is reachable; add a team member and confirm
the same flow.

- [X] T043 [US5] Amend `apps/api/src/provisioning/provision-tenant.ts` (same file as T020,
  sequential): after the transaction commits, generate an OTP (T011), hash and store it as the
  admin's `password_hash` with `must_change_password: true` and `otp_expires_at` set, then call
  `sendOneTimePasswordEmail` (T013) — email failure MUST NOT roll back or fail the provisioning
  response itself (spec Edge Cases). Depends on T020, T011, T013. (Backend-only)
- [X] T044 [US5] Extend `require-tenant-user-session.ts` (T015, same file, sequential): accept an
  `allowMustChangePassword` option; every guarded route except `set-password` continues to reject
  `must_change_password: true` sessions outright (FR-013a, US5 AS3). Depends on T015. (Backend-only)
- [X] T045 [US5] Implement `POST /tenant-auth/set-password` in
  `apps/api/src/tenant-auth/tenant-auth-routes.ts` (same file as US2/US4, sequential), guarded by
  `require-tenant-user-session` with `allowMustChangePassword: true` (T044): hashes and stores the
  new password, clears `must_change_password` and `otp_expires_at` together — the OTP is now
  unusable (FR-013a, US5 AS4). Depends on T044, T038. (Backend-only)
- [X] T046 [US5] Implement `POST /tenant-auth/team` in new
  `apps/api/src/tenant-auth/tenant-team-routes.ts`: guarded by `require-tenant-user-session` +
  `manage_team_members` permission; creates the `users` row with a fresh OTP (T011) exactly like
  T043's provisioning path, assigns the submitted role, sends the OTP email (T013); rejects (`409`)
  a duplicate email at the same tenant, allows it at a different tenant (FR-018, FR-020). Depends
  on T011, T013, T045. (Backend-only)
- [X] T047 [US5] Register `tenant-team-routes` in `apps/api/src/server.ts`. Depends on T046.
  (Backend-only)
- [X] T048 [P] [US5] Write `apps/api/tests/integration/provision-tenant-otp-email.test.ts`:
  provisioning results in the admin's account having `must_change_password: true` and a working
  hashed OTP (FR-013, US5 AS1). Depends on T043. (Backend-only)
- [X] T049 [P] [US5] Write `apps/api/tests/integration/tenant-auth-otp-forces-change.test.ts`:
  logging in with a valid OTP succeeds (`mustChangePassword: true` in the response) but every other
  guarded route (e.g. `GET /tenant-auth/settings/methods`) returns `401`/`403` until
  `POST /tenant-auth/set-password` completes (FR-013a, US5 AS3). Depends on T045. (Backend-only)
- [X] T050 [P] [US5] Write `apps/api/tests/integration/tenant-auth-otp-single-use.test.ts`: after
  `set-password` completes, the original OTP no longer authenticates (FR-013a, US5 AS4). Depends on
  T045. (Backend-only)
- [X] T051 [P] [US5] Write `apps/api/tests/integration/tenant-team-add-member.test.ts`: adding a
  team member sends them their own OTP email and creates a distinct `users` row scoped to the same
  tenant; a duplicate email at that tenant is rejected while the same email succeeds at a different
  tenant (FR-018/FR-020). Depends on T047. (Backend-only)
- [X] T052 [US5] **Frontend — needs UI-UX-Pro-Max skill.** Build
  `apps/web/app/set-password/page.tsx`: requires an active session (any `mustChangePassword`
  state — redirects to `/tenant` if none); submits to `/tenant-api/set-password?subdomain=...`; on
  success redirects to `/tenant`. Depends on T045.
- [X] T053 [US5] **Frontend — needs UI-UX-Pro-Max skill.** Build
  `apps/web/app/settings/team/page.tsx`: requires `manage_team_members`; a minimal form (name,
  email, role) posting to `/tenant-api/team?subdomain=...` — no pending-invitation list, resend, or
  revoke UI (spec Assumptions). Depends on T047.

**Checkpoint**: US5 complete — every account in the system now has a real, working bootstrap path.

---

## Phase 8: User Story 6 - HR Admin Enables an SSO Method as Configured-but-Not-Yet-Functional (Priority: P3)

**Goal**: Microsoft, Google Workspace, and Zoho can be marked "configured" and appear on the login
page in a clearly non-functional, stubbed state.

**Independent Test**: Enable Microsoft for a tenant, visit its login page, confirm the option
appears but doesn't attempt or claim a real login.

- [X] T054 [US6] **Frontend — needs UI-UX-Pro-Max skill.** Extend
  `apps/web/app/settings/authentication/page.tsx` (T026, same file, sequential): allow toggling
  Microsoft, Google Workspace, and Zoho alongside email/password — all four are equally just
  entries in the same `methods` array (FR-016; no backend change needed, since `tenant_auth_methods`
  already supports any of the four values). Depends on T026.
- [X] T055 [US6] **Frontend — needs UI-UX-Pro-Max skill.** Extend `apps/web/app/tenant/page.tsx`
  (T036, same file, sequential): render a visibly disabled/stubbed control for each enabled SSO
  method — interacting with it shows an in-page "not yet available" message, never a broken
  redirect or a silently-ignored click (FR-016, US6 AS1-AS2). Depends on T036.
- [X] T056 [P] [US6] Write
  `apps/api/tests/integration/tenant-routing-resolve-sso-configured.test.ts`: enabling Microsoft via
  `PUT /tenant-auth/settings/methods` is reflected in the resolve endpoint's `enabledAuthMethods`
  with no OAuth configuration of any kind required to do so (FR-016). Depends on T021, T017.
  (Backend-only)

**Checkpoint**: All six user stories independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T057 [P] Expand `apps/api/drizzle/README.md`'s migration table with this feature's new
  migrations (T006–T010), noting the `users` extension is additive and the three new tables use the
  standard RLS policy shape (no narrow allowance, unlike Spec 4's `0018`). Depends on T010.
  (Backend-only)
- [X] T058 [P] Amend `apps/api/.env.example` (and `.env`) documenting `ROOT_DOMAIN`/`SMTP_HOST`/
  `SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` alongside the existing entries — corrected
  from the original task's `apps/web` location: SMTP is consumed by `apps/api`'s mailer, not
  `apps/web`. Depends on T013.
  (Backend-only)
- [ ] T059 Run `quickstart.md`'s full 7-scenario sequence end-to-end against a real SMTP account and
  record the results. Depends on all prior tasks.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (the one install command).
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories** — schema, migrations,
  OTP/cookie/mailer primitives, the session-context plugin + guard, and Spec 4's amendment
  (proven correct by T019) all live here.
- **User Stories (Phase 3–8)**: All depend on Foundational being complete. US1, US2, US4, US5
  progressively extend the same two files (`provision-tenant.ts` and `tenant-auth-routes.ts`) —
  sequential by file within those stories, not fully parallelizable across them despite being
  independently testable. US3 and US6 extend `tenant/page.tsx` and `settings/authentication/page.tsx`
  sequentially after US1/US3 first touch them.
- **Polish (Phase 9)**: Depends on all six user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational.
- **US2 (P1)**: Depends only on Foundational — its own tests seed a user with a real password hash
  directly via SQL fixture specifically to avoid depending on US5's OTP flow, keeping it genuinely
  independently testable even though a *real* new tenant's only path to a real password is through
  US5 in practice.
- **US3 (P2)**: Depends on Foundational's T017 (the resolve-endpoint amendment) and US2's T028 (for
  the authenticated-confirmation branch of `/tenant`).
- **US4 (P2)**: Depends on US2's `tenant-auth-routes.ts` existing (T029) to extend the same file.
- **US5 (P2)**: Depends on US1's T020 and US4's T038 (extends the same files sequentially).
- **US6 (P3)**: Depends on US1's T026 and US3's T036 (extends the same files sequentially) — no new
  backend work at all, purely a frontend + confirmation-test story.

### Within Each User Story

- Backend routes before their tests.
- Backend routes before the frontend pages that call them.
- Story complete before moving to the next priority, given the shared-file coupling noted above.

### Parallel Opportunities

- Foundational: T002–T005 (four independent schema files) in parallel; T011/T012/T013 (three
  independent primitive files) in parallel once T001 lands; T018 in parallel with everything else.
- US1: T023/T024/T025 (three independent test files) in parallel once T022 lands.
- US2: T031/T032/T033/T034 (four independent test files) in parallel once T030 lands.
- US4: T039/T040 in parallel once T038 lands; T041/T042 (independent frontend files) in parallel.
- US5: T048/T049/T050/T051 in parallel once their respective dependencies land.
- Polish: T057/T058 in parallel; T059 runs last as the full validation pass.

---

## Parallel Example: Foundational schema files

```bash
# T002-T005 touch four independent files:
Task: "Amend apps/api/src/db/schema/users.ts with new credential columns"
Task: "Create apps/api/src/db/schema/tenant-auth-methods.ts"
Task: "Create apps/api/src/db/schema/user-sessions.ts"
Task: "Create apps/api/src/db/schema/password-reset-tokens.ts"
```

## Parallel Example: User Story 2 tests

```bash
# After T030 (routes registered) lands, these four are independent test files:
Task: "Write apps/api/tests/integration/tenant-auth-login-success.test.ts"
Task: "Write apps/api/tests/integration/tenant-auth-login-no-enumeration.test.ts"
Task: "Write apps/api/tests/integration/tenant-auth-login-rate-limit.test.ts"
Task: "Write apps/api/tests/integration/tenant-auth-cross-tenant-session.test.ts"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1: Setup (the one `nodemailer` install).
2. Complete Phase 2: Foundational (schema → migrations → primitives → session plugin/guard,
   proven by T019 → Spec 4 amendment).
3. Complete Phase 3: US1 (default method + settings API, no frontend strictly required for a
   backend-only MVP check).
4. Complete Phase 4: US2 (real login, tenant-scoped sessions, rate-limiting, enumeration
   protection) — **this is the practical MVP**, even though US1 is phase-numbered first.
5. **STOP and VALIDATE**: run `quickstart.md` Scenarios 3–4 (using a directly-seeded password
   for a quick check) before tackling OTP/email.

### Incremental Delivery

1. Setup + Foundational → the proven session/RLS substrate and Spec 4 amendment.
2. Add US1 → configuration model works, backend-provable.
3. Add US2 → login itself fully works and is provably tenant-isolated.
4. Add US3 → login page correctly reflects configuration.
5. Add US4 → forgotten-password recovery.
6. Add US5 → the *real* bootstrap path (OTP + forced change + team invites) — only now can a fresh
   tenant be demoed end-to-end without a hand-seeded fixture.
7. Add US6 → SSO stub presentation.
8. Polish → migration README entry, env var docs, full quickstart run against real SMTP.

### Package Install Checkpoint

Exactly one task in this list installs a package: T001 (`nodemailer` + `@types/nodemailer`),
already signed off. No other task should run `pnpm add` — if implementation reveals a need for
something else, stop and get explicit sign-off per constitution Principle XIII first.
