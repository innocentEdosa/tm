---

description: "Task list for implementing the Domain-Based Tenant Routing feature"
---

# Tasks: Domain-Based Tenant Routing

**Input**: Design documents from `/specs/004-tenant-subdomain-routing/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md,
contracts/ (`tenant-routing-resolve-api.md`, `nextjs-middleware-routing.md`), quickstart.md

**Tests**: Included on the `apps/api` side — this feature adds a new RLS policy (Constitution
Principle I is directly in play: the whole point of the `app.subdomain_lookup` allowance is that it
must grant exactly the narrow access intended and no more), matching Specs 1–3's precedent of proving
RLS mechanisms against real Postgres, not mocks. **Not included** on the `apps/web` side: no test
runner exists there today, and that decision was made explicitly, not by default (research.md §6,
plan.md Technical Context) — `apps/web/middleware.ts` and the new pages are verified via
`quickstart.md`'s manual/curl scenarios instead.

**Dependency sign-off status**: None needed — this feature adds no new package (research.md §5, plan.md
Technical Context, "New Dependencies Requiring Justification: None"). No task in this list should run
`pnpm add`.

## Format: `[ID] [P?] [Story?] Description with file path (Backend-only | Frontend — needs UI-UX-Pro-Max skill)`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US5); Setup/Foundational/Polish tasks carry no
  story label

---

## Phase 1: Setup

- [X] T001 Confirm no new dependencies are required for this feature (research.md §5) — Host-header
  parsing is plain string operations and the Next.js→Fastify call uses the built-in `fetch` global on
  both sides; the one dependency-shaped option considered (adding Vitest to `apps/web`) was explicitly
  rejected (research.md §6). A documentation/gate check, not a code change. (Backend-only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The reserved-word list, the RLS policy, the subdomain-resolution function and its
Fastify endpoint, and the Next.js middleware skeleton that every user story routes through. **Nothing
in Phase 3+ can start until this phase (through T008) is complete.**

- [X] T002 [P] Define `RESERVED_SUBDOMAINS` in `apps/api/src/tenant-routing/reserved-subdomains.ts`:
  export a `readonly string[]` containing exactly `www, api, app, admin, mail, ftp, smtp, imap, pop,
  ns1, ns2, static, cdn, assets, help, support, status, docs, blog, dev, staging, test, platform,
  portal, dashboard, login, auth, billing, security, webmail` (spec FR-005, data-model.md). No other
  module defines its own copy of this list. (Backend-only)
- [X] T003 [P] Author `apps/api/drizzle/0018_rls_tenants_subdomain_lookup.sql` (hand-authored SQL, not
  `drizzle-kit generate` output — matches the existing `000{2,3,4}`/`00{9,10,11}_rls_*.sql` precedent
  of hand-authored RLS migrations): add a second, `SELECT`-only permissive policy on `tenants` —
  `CREATE POLICY "tenant_subdomain_lookup" ON "tenants" FOR SELECT USING
  (current_setting('app.subdomain_lookup', true)::boolean IS TRUE);` — leaving the existing
  `tenant_isolation` policy (`0009_rls_tenants.sql`) completely unedited (research.md §2,
  data-model.md). No grant changes needed (`tm_app` already has full CRUD on `tenants` per
  `0012_lock_department_catalog_grants.sql`). (Backend-only)
- [X] T004 Implement `resolveTenantBySubdomain(pool, subdomain)` in
  `apps/api/src/tenant-routing/resolve-tenant.ts`: lowercase the input; if it matches
  `RESERVED_SUBDOMAINS` (T002), return `{ state: "reserved" }` immediately with **no query issued**
  (spec FR-006); otherwise acquire a dedicated client from `pool`, `BEGIN`,
  `SELECT set_config('app.subdomain_lookup', 'true', true)`, `SELECT id, name, status FROM tenants
  WHERE lower(subdomain) = $1`, `COMMIT`, release; map zero rows → `{ state: "not_found" }` (FR-007);
  `status = 'trial' | 'active'` → `{ state: "valid", tenantName: name }` (FR-009); `status =
  'suspended'` → `{ state: "suspended", tenantName: name }`; `status = 'cancelled'` → `{ state:
  "cancelled", tenantName: name }` (FR-008). Never returns `id`/`tenant_id` to callers (research.md
  §4). Depends on T002, T003. (Backend-only)
- [X] T005 Implement `GET /tenant-routing/resolve` in
  `apps/api/src/tenant-routing/tenant-routing-routes.ts`: reads the `subdomain` query param, `400`s
  with `{ success: false, message: "Invalid subdomain" }` if missing or shaped invalidly (contains a
  dot), otherwise calls `resolveTenantBySubdomain` (T004) against `fastify.pg.pool` and returns `200`
  with `{ success: true, data: <result> }` per contracts/tenant-routing-resolve-api.md. No
  authentication/session guard — this endpoint is not tenant-confidential (contract's "Explicitly not
  part of this contract"). Depends on T004. (Backend-only)
- [X] T006 Register `tenant-routing-routes` in `apps/api/src/server.ts`. Depends on T005. (Backend-only)
- [X] T007 [P] Write `apps/api/tests/integration/tenant-routing-rls-policy-mechanism.test.ts`: seed two
  tenants directly via SQL fixture; open a raw connection with `app.tenant_id` set to tenant A's id
  and `app.subdomain_lookup` **unset** — confirm it cannot `SELECT` tenant B's row (existing
  `tenant_isolation` policy alone); open a second raw connection with `app.subdomain_lookup` set to
  `'true'` and `app.tenant_id` **unset** — confirm it **can** `SELECT` both tenants' `id`/`status` by
  subdomain, proving the new policy grants exactly the intended narrow, read-only, cross-tenant
  access (data-model.md, research.md §2) — mirrors `rls-cross-tenant.test.ts`'s precedent of proving
  RLS against real Postgres, not a mock. Depends on T003. (Backend-only)
- [X] T008 Implement `apps/web/middleware.ts` (contracts/nextjs-middleware-routing.md): read
  `request.headers.get("host")`, strip the port, lowercase it; compare against `process.env.ROOT_DOMAIN`
  — exact match or `www.` + root → pass through unmodified (spec FR-001); more than one label before
  root, or a Host matching neither shape → rewrite to `/_not-found-trigger` (built in US3, T016) with
  a `404` status; exactly one label → if the path starts with `/platform`, `/admin`, or `/provisioning`
  as an exact path segment (not a naive substring match, e.g. `/platformx` must NOT match), rewrite to
  `/_not-found-trigger` (spec FR-003, research.md §7); otherwise call `GET
  {process.env.API_ORIGIN}/tenant-routing/resolve?subdomain={label}` (T006, server-to-server — never
  through the browser-facing `/platform-api/*` rewrite proxy, research.md §5) and branch on `state`:
  `reserved`/`not_found` → rewrite to `/_not-found-trigger`; `suspended`/`cancelled` → rewrite to
  `/tenant-status/{state}` setting an `x-tenant-name` header (destination page built in US4, T019);
  `valid` → set `x-tenant-subdomain: {label}` header and rewrite `/` to `/tenant` (destination page
  built in US1, T010; non-root paths on a valid tenant subdomain pass through unmodified — no tenant
  app exists yet, spec Assumptions). Export a `matcher` config excluding `/_next/*` and common static
  asset extensions, so the resolve call isn't made on every asset request. Depends on T006.
  (Frontend — needs UI-UX-Pro-Max skill only for later story pages, not this routing logic itself)
- [X] T009 [P] Add `ROOT_DOMAIN` to `apps/web/.env.example` and `apps/web/.env` (local value: `lvh.me`
  — spec Local Development), documented alongside the existing `API_ORIGIN` entry. (Backend-only)

**Checkpoint**: Reserved list, RLS policy, resolution function, its endpoint, and the middleware
skeleton all exist and are proven (T007) to authorize exactly the intended narrow cross-tenant read.
Every dispatch branch currently rewrites to a placeholder target; user story phases now build those
targets and prove the branches end-to-end.

---

## Phase 3: User Story 1 - A Tenant User Reaches Their Own Organization (Priority: P1) 🎯 MVP

**Goal**: Visiting a valid, active tenant's subdomain resolves to that tenant's own context and shows
its name — never another tenant's.

**Independent Test**: Provision a tenant with subdomain `acmecorp`, visit `acmecorp.lvh.me:3000`,
confirm the response is specific to that tenant.

- [X] T010 [US1] **Frontend — needs UI-UX-Pro-Max skill.** Build
  `apps/web/app/tenant/page.tsx`: a Server Component that reads the `x-tenant-subdomain` header (set
  by middleware, T008) via `next/headers`, calls `GET {API_ORIGIN}/tenant-routing/resolve` itself
  (server-to-server, same pattern as middleware) to get `tenantName`, and renders a minimal "Welcome
  to {tenantName}" placeholder (spec Assumptions — tenant-user authentication doesn't exist yet;
  mirrors Spec 3's minimal-confirmation-screen precedent), following the same nascent design posture
  as every prior UI surface in this codebase (constitution Principle V). Depends on T008.
- [X] T011 [P] [US1] Write `apps/api/tests/integration/tenant-routing-valid-tenant.test.ts`: seed two
  tenants (one `trial`, one `active` status); confirm the resolve endpoint returns `state: "valid"`
  and the correct `tenantName` for each subdomain, and never returns the other tenant's name for
  either (spec SC-001, US1 Acceptance Scenario 2). Depends on T006.
- [X] T012 [US1] Run `quickstart.md` Scenario 1 end-to-end against local `lvh.me` and record the
  result. Depends on T010, T011.

**Checkpoint**: US1 complete and independently demoable — the suggested MVP scope.

---

## Phase 4: User Story 2 - Root Domain and Super Admin Login Stay Isolated From Tenant Subdomains (Priority: P1)

**Goal**: The marketing page and `/platform/login` (and `/admin/*`, `/provisioning/*`) are reachable
only on the root domain, never via any tenant subdomain.

**Independent Test**: Visit the root domain and confirm the marketing page; visit
`{tenant-subdomain}/platform/login` and confirm a 404, not the login form.

- [X] T013 [US2] Review and harden the root-only-path matching added in T008
  (`apps/web/middleware.ts`, same file, sequential): confirm `/platform`, `/admin`, `/provisioning`
  match as exact leading path segments (e.g. via a leading-segment split, not `path.startsWith(...)`
  alone) so a hypothetical tenant-facing path like `/platformx` is never incorrectly blocked. Depends
  on T008.
- [X] T014 [US2] Run `quickstart.md` Scenario 2 end-to-end (root domain marketing page, `/platform/login`
  on root, then `/platform/login`, `/admin/permissions`, `/provisioning/new` on the tenant subdomain
  provisioned in US1 — all three expect `404`) and record the result. Depends on T013, T010.

**Checkpoint**: US2 complete — Super Admin path isolation proven, independent of any new UI (this
story adds no new page — it hardens and verifies behavior middleware already establishes in T008).

---

## Phase 5: User Story 3 - An Unclaimed Subdomain Shows a Clean 404 (Priority: P2)

**Goal**: A subdomain matching no tenant record (and not reserved) returns a clean 404 — no fallback,
no redirect.

**Independent Test**: Visit a made-up subdomain and confirm a clean 404 page, not a default tenant or
a redirect.

- [X] T015 [US3] **Frontend — needs UI-UX-Pro-Max skill.** Author `apps/web/app/not-found.tsx`: a
  minimal, on-brand "page not found" message (Next.js's global not-found boundary), following the same
  nascent design posture as every prior UI surface (constitution Principle V).
- [X] T016 [US3] Add `apps/web/app/_not-found-trigger/page.tsx`: a Server Component that calls
  `notFound()` from `next/navigation` immediately on render, so requests rewritten here by middleware
  render T015's custom page with a real `404` status. Extend `apps/web/middleware.ts`'s
  `not_found`/`reserved`/multi-label/malformed-Host branches (T008, same file, sequential) to rewrite
  to this route. Depends on T008, T015.
- [X] T017 [P] [US3] Write `apps/api/tests/integration/tenant-routing-not-found.test.ts`: the resolve
  endpoint returns `state: "not_found"` for a subdomain matching no tenant record and not on
  `RESERVED_SUBDOMAINS` (spec FR-007). Depends on T006.
- [X] T018 [US3] Run `quickstart.md` Scenario 3 (`doesnotexist.lvh.me:3000` → confirm `404`) and record
  the result. Depends on T016, T017.

**Checkpoint**: US3 complete.

---

## Phase 6: User Story 4 - A Suspended or Cancelled Tenant's Subdomain Shows Its Own Status Page (Priority: P2)

**Goal**: A tenant whose status is Suspended or Cancelled shows a distinct, status-specific page — not
a 404, not a login form.

**Independent Test**: Set a provisioned tenant's status to Suspended, visit its subdomain, confirm the
distinct status page renders.

- [X] T019 [US4] **Frontend — needs UI-UX-Pro-Max skill.** Build
  `apps/web/app/tenant-status/[state]/page.tsx`: reads the `state` route param (`suspended` |
  `cancelled`) and the `x-tenant-name` header, rendering a distinct, status-specific message per spec
  FR-008 and US4's two acceptance scenarios (Suspended vs. Cancelled read differently, neither reads
  as a 404 or a login form). Depends on T008.
- [X] T020 [US4] Extend `apps/web/middleware.ts`'s `suspended`/`cancelled` branch (T008, same file,
  sequential) to rewrite to `/tenant-status/{state}` while preserving the visible URL, setting
  `x-tenant-name` from the resolve response. Depends on T019.
- [X] T021 [P] [US4] Write `apps/api/tests/integration/tenant-routing-suspended-cancelled.test.ts`: the
  resolve endpoint returns `state: "suspended"`/`"cancelled"` with the correct `tenantName` for tenants
  in those statuses, and never returns `state: "valid"` for either (spec FR-008, US4 Acceptance
  Scenarios 1–2). Depends on T006.
- [X] T022 [US4] Run `quickstart.md` Scenario 4 (update the US1 tenant's status to `suspended` via SQL,
  confirm the distinct page; repeat for `cancelled`; restore to `active` afterward) and record the
  result. Depends on T020, T021.

**Checkpoint**: US4 complete.

---

## Phase 7: User Story 5 - Reserved Words Can Never Become a Tenant's Subdomain (Priority: P3)

**Goal**: No tenant can claim a reserved subdomain during provisioning, and a reserved word never
resolves as a tenant via routing even if one somehow existed in `tenants`.

**Independent Test**: Attempt to provision a tenant with subdomain `admin`, confirm rejection;
separately confirm `admin.lvh.me:3000` never resolves to a tenant lookup result.

- [X] T023 [US5] Amend `apps/api/src/provisioning/provision-tenant.ts` (Spec 2, FR-016): import
  `RESERVED_SUBDOMAINS` (T002); before attempting the tenant insert, check the submitted (lowercased)
  subdomain against it and throw a new `ReservedSubdomainError extends Error` if matched — checked
  before the existing unique-constraint-driven `SubdomainTakenError` path, same file. Depends on T002.
- [X] T024 [US5] Amend `apps/api/src/provisioning/provisioning-routes.ts` (same file, sequential) to
  catch `ReservedSubdomainError` and return `409` with a clear message, alongside the existing
  `SubdomainTakenError`/`DuplicateDepartmentNameError` handling. Depends on T023.
- [X] T025 [P] [US5] Write `apps/api/tests/integration/provision-tenant-reserved-subdomain.test.ts`:
  submitting a reserved word (e.g. `admin`) as a new tenant's subdomain is rejected with `409` and no
  tenant record is created (Spec 2 FR-016). Depends on T024.
- [X] T026 [P] [US5] Write `apps/api/tests/integration/tenant-routing-reserved-rejected.test.ts`: for
  every word in `RESERVED_SUBDOMAINS`, the resolve endpoint returns `state: "reserved"`; additionally,
  insert a `tenants` row directly via SQL fixture whose `subdomain` is a reserved word (bypassing
  application-level validation on purpose) and confirm the resolve endpoint **still** returns
  `"reserved"`, never `"valid"` — proving FR-006's "regardless of what exists in the tenant records"
  guarantee. Depends on T006, T002.
- [X] T027 [US5] Run `quickstart.md` Scenario 5 (`admin.lvh.me:3000` → `404`; provisioning attempt with
  subdomain `admin` → `409`) and record the result. Depends on T025, T026.

**Checkpoint**: All five user stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T028 [P] Expand `apps/api/drizzle/README.md`'s migration table with `0018` (this feature's
  migration), matching the existing table format, noting it as additive (no edit to `0009_rls_tenants.sql`)
  and requiring no grant changes. Depends on T003.
- [X] T029 [P] Write `apps/api/tests/integration/tenant-routing-case-insensitive.test.ts`: the resolve
  endpoint treats `ACMECorp` and `acmecorp` identically (spec Edge Cases). Depends on T006.
- [X] T030 [P] Run `quickstart.md`'s remaining Edge Cases section (`ACMECorp` casing via browser/curl,
  `foo.acmecorp.lvh.me:3000` multi-label rejection) end-to-end and record the results. Depends on all
  prior tasks.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories** — the reserved list, RLS
  policy, resolution function, its endpoint, and the middleware skeleton (proven correct by T007) all
  live here before any story-specific page exists.
- **User Stories (Phase 3–7)**: All depend on Foundational (through T008/T009) being complete. US2–US4
  extend the same `apps/web/middleware.ts` file US1 first touches (T008) — sequential by file, not
  parallelizable across stories, same coupling pattern Spec 3's `platform-auth-routes.ts` established.
  US5 is independent of the middleware file entirely (touches `provisioning/`, not `tenant-routing/`
  or `middleware.ts`) and could run in parallel with US1–US4 if staffed separately.
- **Polish (Phase 8)**: Depends on all five user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. The MVP — valid tenant subdomain resolution + landing
  placeholder.
- **US2 (P1)**: Hardens and verifies middleware behavior Foundational (T008) already establishes —
  reuses the tenant subdomain US1 provisions to test against, not independently deployable before US1
  in practice, but independently testable via its own quickstart scenario.
- **US3 (P2)**: Extends `middleware.ts` (same file as US1/US2) and adds two new, independent pages —
  no dependency on US1/US2's specific pages.
- **US4 (P2)**: Extends `middleware.ts` (same file) and adds one new, independent page — no dependency
  on US1/US2/US3's specific pages.
- **US5 (P3)**: Independent of `middleware.ts` entirely — only depends on Foundational's T002
  (reserved list) and touches `provisioning/`, not `tenant-routing/`.

### Within Each User Story

- Reserved list / RLS policy / resolution function / endpoint / middleware skeleton (Foundational)
  before any story-specific page or provisioning amendment.
- Each story's page/amendment before its tests.
- Story complete before moving to the next priority, given the shared-file coupling on
  `middleware.ts` for US1–US4.

### Parallel Opportunities

- Foundational: T002 and T003 in parallel (independent files); T007 depends on T003 alone (not T004–T006);
  T009 in parallel with everything else in this phase.
- US1: T011 (backend test) has no dependency on T010 (frontend page) beyond both needing T006/T008 —
  can run in parallel.
- US3: T015 (not-found page) and T017 (backend test) are independent files — parallel; T016 depends
  on T015.
- US4: T021 (backend test) is independent of T019/T020 — parallel.
- US5: entirely parallel with US1–US4 if staffed separately (no shared file).
- Polish: T028, T029, T030 in parallel-ish (T030 realistically runs last as a full validation pass).

---

## Parallel Example: Foundational

```bash
# T002 and T003 have no dependency on each other:
Task: "Define RESERVED_SUBDOMAINS in apps/api/src/tenant-routing/reserved-subdomains.ts"
Task: "Author apps/api/drizzle/0018_rls_tenants_subdomain_lookup.sql"
```

## Parallel Example: User Story 5 (independent of the middleware-coupled stories)

```bash
# Can proceed on its own timeline, in parallel with US1-US4:
Task: "Amend apps/api/src/provisioning/provision-tenant.ts to reject reserved subdomains"
Task: "Amend apps/api/src/provisioning/provisioning-routes.ts to map ReservedSubdomainError to 409"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (confirm no new deps).
2. Complete Phase 2: Foundational (reserved list → RLS policy → resolution function, proven by T007
   → endpoint → middleware skeleton).
3. Complete Phase 3: User Story 1 (tenant landing placeholder).
4. **STOP and VALIDATE**: run `quickstart.md` Scenario 1.
5. Demo: provision a tenant → visit its subdomain → see its own landing page.

### Incremental Delivery

1. Setup + Foundational → the proven RLS/resolution substrate and middleware skeleton.
2. Add US1 → valid tenant resolution (MVP, demoable).
3. Add US2 → root/`/platform` isolation proven (no new UI).
4. Add US3 → clean 404 for unclaimed subdomains.
5. Add US4 → distinct suspended/cancelled status page.
6. Add US5 → reserved words locked out of provisioning too (can be pulled forward in parallel, since
   it doesn't touch `middleware.ts`).
7. Polish → migration README entry, remaining edge-case coverage, full quickstart run.

### Package Install Checkpoint

No task in this list installs a new package — if implementation reveals a need for something else,
stop and get explicit sign-off per constitution Principle XIII before adding it.
