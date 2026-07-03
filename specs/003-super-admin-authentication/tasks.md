---

description: "Task list for implementing the Super Admin Authentication feature"
---

# Tasks: Super Admin Authentication

**Input**: Design documents from `/specs/003-super-admin-authentication/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md,
contracts/ (`platform-auth-api.md`, `seed-super-admin-script.md`), quickstart.md

**Tests**: Included — this is the most security-critical spec in the project so far (platform-operator
credentials and sessions), and the spec's own Success Criteria (SC-002–SC-006) require proof of
session-type rejection, no-enumeration, and rate-limiting. Test tasks are not optional, matching
Specs 1–2's precedent.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md §1,
plan.md Technical Context). No task in this list should run `pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1, US2, US3); Setup/Foundational/Polish tasks carry
  no story label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md §1) — password
  hashing (`node:crypto` scrypt), cookies (hand-rolled), rate-limit state (Drizzle columns), and
  session tokens (`node:crypto` randomBytes) are all built on the existing stack. A
  documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema → grants → the auth primitives (hashing, cookies, tokens) → the session-context
plugin and guard, shared by every user story. **Nothing in Phase 3+ can start until this phase
(through T012) is complete.**

- [X] T002 [P] Define `super_admins` table schema in `apps/api/src/db/schema/super-admins.ts` (`id`,
  `email` unique not null, `password_hash` not null, `name` not null, `failed_login_count` integer not
  null default `0`, `locked_until` nullable timestamptz, `created_at`, `last_login_at` nullable) per
  data-model.md `super_admins`. (Backend-only)
- [X] T003 Define `super_admin_sessions` table schema in the same file (`id`, `super_admin_id` FK →
  `super_admins.id` `ON DELETE CASCADE`, `token_hash` unique not null, `created_at`, `expires_at` not
  null, `revoked_at` nullable) per data-model.md `super_admin_sessions` — same file as T002,
  sequential. (Backend-only)
- [X] T004 Generate the Drizzle migration from T002–T003 via `drizzle-kit generate`, producing
  `apps/api/drizzle/0017_init_super_admin_auth.sql`. No RLS statements are expected in the generated
  output (neither table has a `tenant_id` column). Depends on T002, T003. (Backend-only)
- [X] T005 [P] Author `apps/api/drizzle/0018_lock_super_admin_grants.sql`: `GRANT SELECT, UPDATE` on
  `super_admins` to `tm_app` — deliberately **no `INSERT`** (research.md §7); `GRANT SELECT, INSERT,
  UPDATE` on `super_admin_sessions` to `tm_app`. Depends on T004. (Backend-only)
- [X] T006 [P] Implement password hashing helpers in `apps/api/src/platform-auth/password.ts`:
  `hashPassword(password)` using `node:crypto`'s `scrypt` with a random per-call salt, returning a
  combined salt+hash encoded string; `verifyPassword(password, stored)` re-deriving the hash and
  comparing via `crypto.timingSafeEqual` (research.md §1). (Backend-only)
- [X] T007 [P] Implement cookie helpers in `apps/api/src/platform-auth/cookies.ts`: `parseCookie(header,
  name)` (reads one named value out of a `Cookie` request header) and `serializeCookie(name, value,
  { maxAgeSeconds })` (builds a `Set-Cookie` value with `HttpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/platform`) (research.md §3). (Backend-only)
- [X] T008 [P] Implement session token helpers in `apps/api/src/platform-auth/session.ts`:
  `generateSessionToken()` via `crypto.randomBytes(32).toString("hex")`; `hashSessionToken(token)` via
  a `sha256` hex digest (research.md §2). (Backend-only)
- [X] T009 Implement the `super-admin-context` Fastify plugin in
  `apps/api/src/platform-auth/super-admin-context.ts`, mirroring
  `apps/api/src/plugins/tenant-context.ts`'s idiom exactly: on every request, parse the
  `tm_super_admin_session` cookie (T007), hash it (T008), look up a matching
  `super_admin_sessions` row via `fastify.db` where `revoked_at IS NULL AND expires_at > now()`; if
  found, acquire a dedicated client from `fastify.pg.pool`, `BEGIN`,
  `SELECT set_config('app.is_super_admin', 'true', true)`, decorate `request.superAdmin =
  { id, email, name }` and `request.superAdminDb`; commit + release on `onResponse`, rollback +
  release on `onError` (research.md §6). Depends on T005, T007, T008. (Backend-only)
- [X] T010 Implement `requireSuperAdminSession()` preHandler in
  `apps/api/src/platform-auth/require-super-admin-session.ts`: replies `401` if `request.superAdmin`
  is not set (deny by default, mirrors `requirePermission`'s precedent). Depends on T009. (Backend-only)
- [X] T011 Register the `super-admin-context` plugin in `apps/api/src/server.ts`. Depends on T009.
  (Backend-only)
- [X] T012 [P] Write `apps/api/tests/integration/super-admin-context-mechanism.test.ts`: seed a
  `super_admins` row and `super_admin_sessions` rows directly via SQL fixtures (one valid, one
  expired, one revoked); register a minimal ad-hoc test route (`server.get(...)`, guarded by
  `requireSuperAdminSession`) that returns `current_setting('app.is_super_admin', true)` read through
  `request.superAdminDb`; assert the valid session's cookie → `200` with the flag read back as
  `'true'`, and the expired/revoked/missing/malformed cases → `401`. Depends on T010, T011.
  (Backend-only)

**Checkpoint**: Schema, grants, hashing/cookie/token primitives, and the session-context plugin +
guard all exist and are proven — by T012 — to set `app.is_super_admin` correctly for a real request.
User story phases can now begin.

---

## Phase 3: User Story 1 - Bootstrap and Log In as the First Super Admin (Priority: P1) 🎯 MVP

**Goal**: The seed script creates the first Super Admin; valid credentials at the dedicated login
route issue a session; the authenticated landing confirmation is reachable with it.

**Independent Test**: Run the seed script against an empty `super_admins` table, then submit those
credentials at `POST /platform/login` and confirm a session is issued and `GET /platform/me` succeeds.

- [X] T013 [US1] Implement `POST /platform/login` (success path + baseline generic-failure response)
  in `apps/api/src/platform-auth/platform-auth-routes.ts`: look up `super_admins` by
  lowercased email; if not found or `verifyPassword` (T006) fails, return `401` with the identical
  generic message (FR-008's baseline shape — rate-limiting and timing-equalization are added in
  User Story 3); on success, generate + hash a session token (T008), insert a `super_admin_sessions`
  row (`expires_at` = now + 8 hours), set the session cookie (T007), update `last_login_at`, return
  `200` with `{ id, email, name }` (contracts/platform-auth-api.md). Depends on T006, T007, T008,
  T009. (Backend-only)
- [X] T014 [US1] Implement `GET /platform/me` in the same file, guarded by `requireSuperAdminSession`
  (T010): returns `{ id, email, name, lastLoginAt }` plus `isSuperAdminFlagSet` read via
  `request.superAdminDb`'s `current_setting('app.is_super_admin', true)` — the concrete FR-012/FR-013
  proof (research.md §5). Same file as T013, sequential. Depends on T013. (Backend-only)
- [X] T015 [US1] Implement `POST /platform/logout` in the same file, guarded by
  `requireSuperAdminSession`: sets the current session's `revoked_at = now()`, clears the cookie
  (`Max-Age=0`), returns `204` (FR-011). Same file, sequential. Depends on T014. (Backend-only)
- [X] T016 Register `platform-auth-routes` in `apps/api/src/server.ts`. Depends on T015. (Backend-only)
- [X] T017 [US1] Implement the standalone seed script `apps/api/scripts/seed-super-admin.ts` per
  `contracts/seed-super-admin-script.md`: connects via `DATABASE_URL` directly (never
  `APP_DATABASE_URL` — research.md §7); reads `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` from the
  environment, falling back to an interactive prompt via `node:readline/promises` if either is unset;
  runs `SELECT count(*) FROM super_admins`, exiting without inserting if the count is `> 0` and
  `ALLOW_ADDITIONAL_SUPER_ADMIN` is not `"true"`; otherwise hashes the password (T006) and inserts.
  Depends on T006. (Backend-only)
- [X] T018 [P] Add a `seed:super-admin` script entry (`"tsx scripts/seed-super-admin.ts"`) to
  `apps/api/package.json`. Depends on T017. (Backend-only)
- [X] T019 [P] [US1] Write `apps/api/tests/integration/seed-super-admin-script.test.ts`: running the
  script against an empty `super_admins` table creates exactly one row with a securely hashed password
  (never plaintext, verified by inspecting the stored value); running it again without
  `ALLOW_ADDITIONAL_SUPER_ADMIN` makes no changes (FR-015, SC-005). Depends on T018. (Backend-only)
- [X] T020 [P] [US1] Write `apps/api/tests/integration/platform-login-success.test.ts`: valid
  credentials against a seeded Super Admin return `200` with a `Set-Cookie` header and
  `{ id, email, name }`; `last_login_at` is updated in the database. Depends on T016. (Backend-only)
- [X] T021 [P] [US1] Write `apps/api/tests/integration/platform-me-confirmation.test.ts`: presenting
  the cookie from a successful login to `GET /platform/me` returns `200` with
  `isSuperAdminFlagSet: true` and the correct account fields (User Story 1, Acceptance Scenario 2).
  Depends on T016. (Backend-only)
- [X] T022 [P] [US1] Write `apps/api/tests/integration/platform-logout.test.ts`: logging out revokes
  the session; a subsequent `GET /platform/me` with the same cookie returns `401` (FR-011). Depends on
  T016. (Backend-only)
- [X] T023 [US1] **Frontend — needs UI-UX-Pro-Max skill.** Build the Super Admin login page at
  `apps/web/app/platform/login/page.tsx` (email/password form, `POST /platform/login`, redirect to
  `/platform` on success) and the landing confirmation at `apps/web/app/platform/page.tsx` (calls
  `GET /platform/me`, shows the confirmation and a logout button calling `POST /platform/logout`),
  following the same minimal design posture as every prior UI surface in this codebase (constitution
  Principle V). Depends on T016.

**Checkpoint**: US1 complete and independently demoable — this is the suggested MVP scope
(SC-001: seed → login → confirmation in under 2 minutes).

---

## Phase 4: User Story 2 - Super Admin and Tenant Sessions Can Never Be Confused (Priority: P1)

**Goal**: Prove, in both directions, that a tenant-scoped session and a Super Admin session are never
interchangeable at the request layer.

**Independent Test**: Present a tenant-scoped session to a Super Admin-only route and confirm
rejection; present a Super Admin session to a tenant-scoped route and confirm rejection.

- [X] T024 [US2] Extend `requireSuperAdminSession()`
  (`apps/api/src/platform-auth/require-super-admin-session.ts`) to also reply `401` if
  `request.user` is present — a defensive rejection even though the two session types cannot co-occur
  by construction (different cookie vs. header mechanisms, research.md §4), covering the case where a
  client sends both a Super Admin cookie and Spec 1's dev-auth-stub tenant headers on the same
  request. Same file as T010, sequential. Depends on T010. (Backend-only)
- [X] T025 [P] [US2] Write
  `apps/api/tests/integration/platform-auth-rejects-tenant-session.test.ts`: presenting only Spec 1's
  dev-stub tenant headers (`x-dev-user-id`/`x-dev-tenant-id`, no Super Admin cookie) to
  `GET /platform/me` returns `401` (User Story 2, Acceptance Scenario 1). Depends on T024, T016.
  (Backend-only)
- [X] T026 [P] [US2] Write
  `apps/api/tests/integration/platform-auth-rejects-both-present.test.ts`: presenting both a valid
  Super Admin session cookie *and* Spec 1's dev-stub tenant headers on the same request to
  `GET /platform/me` returns `401` (T024's defensive check), even though the Super Admin cookie alone
  would have succeeded. Depends on T024, T016. (Backend-only)
- [X] T027 [P] [US2] Write
  `apps/api/tests/integration/tenant-route-rejects-super-admin-session.test.ts`: presenting a valid
  Super Admin session cookie (no dev-stub headers) to an existing Spec 1 tenant-scoped protected route
  (`POST /_internal/protected-demo`) returns `403` — proving the "vice versa" direction holds via
  Spec 1's existing, unmodified `requirePermission` logic, with zero changes to Spec 1's code
  (research.md §4; User Story 2, Acceptance Scenario 2). Depends on T016 (a real Super Admin session
  must exist to obtain a cookie). (Backend-only)
- [X] T028 [P] [US2] Write `apps/api/tests/integration/platform-flag-not-client-settable.test.ts`: a
  request to `GET /platform/me` carrying a forged header (e.g. `x-is-super-admin: true`) or an
  invented, non-existent session token is rejected/ignored exactly as if no session were presented —
  `request.superAdmin` and `app.is_super_admin` are derived only from a real, DB-verified session
  (FR-012, Acceptance Scenario 3). Depends on T016. (Backend-only)

**Checkpoint**: US2 complete — session-type isolation is proven in both directions, independent of any
UI (SC-002).

---

## Phase 5: User Story 3 - Failed Logins Are Rate-Limited and Reveal Nothing (Priority: P2)

**Goal**: Wrong-password and unknown-email produce indistinguishable responses; repeated failures
lock out further attempts, even with correct credentials, until a cool-down elapses.

**Independent Test**: Compare responses for a wrong password vs. an unknown email; exceed the failure
threshold and confirm lockout; confirm the lockout clears automatically after the cool-down.

- [X] T029 [US3] Extend `POST /platform/login`
  (`apps/api/src/platform-auth/platform-auth-routes.ts`) with rate-limiting: before verifying
  credentials for a known email, check `locked_until`; if `now() < locked_until`, return `429` with a
  distinct "too many attempts" message (FR-009, research.md §9); on a failed verification for a known
  email, increment `failed_login_count`, setting `locked_until = now() + 15 minutes` once it reaches
  `5`; on success, reset `failed_login_count` to `0`. Same file as T013–T015, sequential. Depends on
  T013. (Backend-only)
- [X] T030 [US3] Extend `POST /platform/login` with timing-equalization for unknown emails: when the
  submitted email isn't found, perform a dummy `verifyPassword` call against a fixed, pre-computed
  dummy hash before returning the same generic `401` used for a wrong password (research.md §9), so
  response timing doesn't distinguish the two cases. Same file, sequential. Depends on T029.
  (Backend-only)
- [X] T031 [P] [US3] Write `apps/api/tests/integration/platform-login-no-enumeration.test.ts`: a wrong
  password for a real seeded email and a login attempt for a nonexistent email return byte-identical
  response bodies and the same status code (FR-008, SC-003; User Story 3, Acceptance Scenario 1).
  Depends on T030. (Backend-only)
- [X] T032 [P] [US3] Write `apps/api/tests/integration/platform-login-rate-limit.test.ts`: 5
  consecutive failed attempts against the same email lock it out; a 6th attempt with the *correct*
  password still returns `429` until `locked_until` elapses; a successful login after the lockout
  window resets `failed_login_count` to `0` (FR-009, SC-004; User Story 3, Acceptance Scenarios 2–3).
  Depends on T030. (Backend-only)

**Checkpoint**: All three user stories complete — the full, hardened `/platform` auth flow exists
end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T033 [P] Expand `apps/api/drizzle/README.md`'s migration table with `0017`–`0018` (this
  feature's migrations), matching the existing table format, and note that neither new table carries
  RLS (no `tenant_id` column). Depends on T005. (Backend-only)
- [X] T034 [P] Run `quickstart.md` end-to-end against the local `docker-compose.yml` Postgres instance
  and record the results (all five scenarios). Depends on all prior tasks. (Backend-only)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories** — schema, grants, the
  hashing/cookie/token primitives, and the session-context plugin + guard all live here, proven
  correct by T012 before any story-specific route is added.
- **User Stories (Phase 3–5)**: All depend on Foundational (through T012) being complete. US2 and US3
  extend the same route file US1 creates (`platform-auth-routes.ts`) and the same guard file
  Foundational creates (`require-super-admin-session.ts`) — sequential by file, not parallelizable
  across stories, same coupling pattern as Spec 2's `provisionTenant`.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. The MVP — bootstrap, login, session, landing
  confirmation.
- **US2 (P1)**: Extends the Foundational guard (T024) and depends on US1's routes existing to obtain
  real sessions to test against (T025–T028) — not independently deployable before US1, but
  independently testable via its own assertions.
- **US3 (P2)**: Extends US1's login route directly (same file) — same caveat.

### Within Each User Story

- Schema/grants/primitives/plugin/guard (Foundational) before any story-specific route logic.
- Each story's route/script logic before its tests.
- Story complete before moving to the next priority, given the shared-file coupling above.

### Parallel Opportunities

- Foundational: T002 and T003 are sequential (same file); T006, T007, T008 in parallel (three
  independent, dependency-free helper files); T005 in parallel with T006–T008 once T004 lands; T012 is
  the only test task in this phase.
- US1: T017 (seed script) has no dependency on T013–T016 (different concern, only needs T006) — can
  run in parallel with the route work; T019–T022 in parallel once their respective dependencies land;
  T023 (frontend) can start once T016 lands, in parallel with the backend test tasks.
- US2: T025, T026, T027, T028 all in parallel once T024/T016 land (four independent test files).
- US3: T031, T032 in parallel once T030 lands.
- Polish: T033, T034 in parallel-ish (T034 realistically runs last as a full validation pass).

---

## Parallel Example: Foundational primitives

```bash
# After T004 (generated migration) and T005 (grants) are underway, these three helper
# modules have no dependency on each other or on the plugin:
Task: "Implement password hashing helpers in apps/api/src/platform-auth/password.ts"
Task: "Implement cookie helpers in apps/api/src/platform-auth/cookies.ts"
Task: "Implement session token helpers in apps/api/src/platform-auth/session.ts"
```

## Parallel Example: User Story 2 tests

```bash
# After T024 (defensive guard check) and T016 (routes registered) land, these four are
# independent test files:
Task: "Write apps/api/tests/integration/platform-auth-rejects-tenant-session.test.ts"
Task: "Write apps/api/tests/integration/platform-auth-rejects-both-present.test.ts"
Task: "Write apps/api/tests/integration/tenant-route-rejects-super-admin-session.test.ts"
Task: "Write apps/api/tests/integration/platform-flag-not-client-settable.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (confirm no new deps).
2. Complete Phase 2: Foundational (schema → grants → primitives → plugin → guard, proven by T012).
3. Complete Phase 3: User Story 1 (seed script, login, session, landing confirmation, frontend).
4. **STOP and VALIDATE**: run quickstart.md Scenarios 1–2.
5. Demo: seed script → login at `/platform/login` → landing confirmation at `/platform`.

### Incremental Delivery

1. Setup + Foundational → the isolated, proven session-context substrate.
2. Add US1 → bootstrap + login + confirmation (MVP, demoable).
3. Add US2 → session-type isolation proven in both directions, independent of any UI.
4. Add US3 → rate-limiting and no-enumeration harden the already-working login path.
5. Polish → documentation, full quickstart run.

### Package Install Checkpoint

No task in this list installs a new package — if implementation reveals a need for something else,
stop and get explicit sign-off per constitution Principle XIII before adding it.
