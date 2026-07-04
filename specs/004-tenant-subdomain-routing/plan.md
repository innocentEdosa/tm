# Implementation Plan: Domain-Based Tenant Routing

**Branch**: `004-tenant-subdomain-routing` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-tenant-subdomain-routing/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a Next.js middleware layer (`apps/web/middleware.ts`) that reads the Host header on every
request, classifies it as root domain, a candidate tenant subdomain, or invalid, and either serves the
existing marketing page unmodified, blocks root-domain-only paths (`/platform`, `/admin`,
`/provisioning`) with a clean 404, or calls a new, narrow Fastify endpoint
(`GET /tenant-routing/resolve`) to resolve the subdomain. That endpoint is the *only* thing that ever
queries Postgres for this feature — it checks a shared reserved-word list first, then looks up
`tenants` by subdomain under a new, narrow RLS allowance (a second `SELECT`-only permissive policy on
`tenants`, gated by a server-set `app.subdomain_lookup` flag — never a `BYPASSRLS` role, per Spec 3's
precedent) and returns one of `reserved | not_found | suspended | cancelled | valid`. Middleware acts
on that response: 404, rewrite to a status page, or rewrite to a minimal tenant-confirmation page while
forwarding the raw subdomain (never a tenant_id) downstream via an `x-tenant-subdomain` header. Spec
2's provisioning code is amended (FR-016) to reject the same reserved words at submission time, sharing
one canonical list with this feature. `app.tenant_id` for actual RLS-scoped tenant data access is
untouched — it continues to be set only from the authenticated session in
`apps/api/src/plugins/tenant-context.ts`. One new additive migration (`0018`); no new tables, no new
dependencies.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (`.nvmrc`), matching `apps/api`'s existing
`packages/tsconfig/node.json` and `apps/web`'s `@tm/tsconfig/nextjs.json` — unchanged from Specs 1–3.

**Primary Dependencies**: Next.js 15 middleware (`apps/web`), Fastify 5 + `drizzle-orm` + `pg`
(`apps/api`) — all already installed. No new library for either side: subdomain/Host parsing is plain
string operations, and the Next.js→Fastify call uses the platform `fetch` global already available in
both Next.js middleware and Node 20.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Considered and
rejected: adding Vitest to `apps/web` to unit-test the middleware's Host-parsing function — `apps/web`
has no test runner today (research.md §6) and this feature's actual decision logic (reserved-word
check, tenant lookup, status branching) lives entirely in `apps/api`, which already has full Vitest
integration-test coverage per Specs 1–3's convention; the small amount of pure parsing logic left in
`middleware.ts` is verified via `quickstart.md`'s manual/curl scenarios instead. If a future spec adds
substantial Next.js-side logic, introducing a test runner there should be proposed then, with sign-off,
not smuggled in on this feature's back.

**Storage**: PostgreSQL — same database as Specs 1–3. One new additive migration (`0018`, planned
name `rls_tenants_subdomain_lookup.sql`) adding a second, `SELECT`-only permissive RLS policy to the
existing `tenants` table (research.md §2; spec FR-015). No new tables, no grant changes (`tm_app`
already has full CRUD on `tenants` since `0012_lock_department_catalog_grants.sql` — the `tenant_isolation`
policy just currently limits *which rows*).

**Testing**: Vitest, matching Specs 1–3's `apps/api/tests/integration/` convention — real Postgres
connection, no mocks, since the reserved-word/not-found/suspended/valid branching and the RLS policy
itself (research.md §2) can't be verified as "actually enforced" against a mock. `apps/web`'s
middleware is verified via `quickstart.md`'s manual/curl scenarios (research.md §6) — no automated
frontend test is added by this feature.

**Target Platform**: Vercel (`apps/web`, confirmed via `apps/web/.vercel/project.json`) + the existing
Fastify host (`apps/api`) — unchanged from prior specs. Wildcard DNS/SSL setup (spec Assumptions) is a
deployment prerequisite tracked in tasks.md, not something this plan's code changes can satisfy on
their own.

**Project Type**: Web-service + web-app — extends both existing apps in place, exactly as Specs 1–3
did. No new app, no new package.

**Performance Goals**: No hard SLA specified by the spec. The middleware's Fastify round-trip happens
on every request to a candidate tenant subdomain (not on root-domain or already-invalid requests, which
short-circuit before any network call) — acceptable at this milestone's expected tenant/traffic volume
(a small number of Trial/Active tenants); caching the resolve result is explicitly not required for
this feature and is left as a future optimization if traffic volume warrants it.

**Constraints**: The subdomain lookup MUST run under the new narrow RLS allowance (`app.subdomain_lookup`),
never a `BYPASSRLS` role (spec FR-015, research.md §2). `apps/web/middleware.ts` MUST NOT open a direct
Postgres connection — all tenant data access stays in `apps/api`, consistent with Principle XI. Only
the raw subdomain string ever crosses the Next.js→Fastify boundary for this feature — never a
tenant_id (research.md §4; spec FR-004, FR-010).

**Scale/Scope**: One new Fastify module (`apps/api/src/tenant-routing/`, 3 files), one amendment to
`apps/api/src/provisioning/provision-tenant.ts` (Spec 2, FR-016), one new Next.js middleware file, two
to three new minimal Next.js pages (tenant landing placeholder, suspended/cancelled status page, 404
is Next.js's own convention), one new migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | The new subdomain lookup is authorized by an explicit, narrow RLS allowance clause (`app.subdomain_lookup`), not a `BYPASSRLS` role — following Spec 3's precedent exactly (research.md §2). `app.tenant_id` for real tenant-scoped data access is untouched (FR-011); FR-012 adds a session/subdomain consistency check that closes a gap not previously covered by any prior spec. |
| II. Tenant provisioning includes org structure | N/A | This feature does not touch department/role provisioning structure. |
| III. Forms/flows are tenant-configurable | N/A | No tenant-facing form or approval flow is touched. |
| IV. Spec-before-code | **PASS** | Follows the ratified, clarified spec.md; all three Clarifications-session decisions (reserved-word list, Spec 2 amendment, RLS lookup mechanism) are threaded through this plan, not invented here. |
| V. Design system (locked via UI-UX-Pro-Max) | **DEFERRED** | Still not locked (same posture as every prior UI surface in this codebase). The two new UI surfaces (tenant landing placeholder, suspended/cancelled status page) are tracked in Complexity Tracking below. |
| VI. Plan-tier awareness | N/A | Subdomain routing applies uniformly regardless of plan tier; no tier-gated behavior in this feature. |
| VII. White-labeling & structural customization | N/A | No tenant branding or org structure is touched — the reserved-subdomain list and root-domain/`/platform` isolation are intentionally fixed platform-wide (spec Constitution Alignment), not tenant-configurable. |
| VIII. Comprehensive-version rule | **PASS** | The reserved-subdomain list is shared (one canonical source, consulted by both this spec and Spec 2) rather than two independently-maintained lists that could drift — the more complete, less error-prone option, confirmed via Clarifications. |
| IX. Demoable vs. internal | **PASS** | Explicitly demoable per spec.md Constitution Alignment: root domain → marketing, `/platform/login` → Super Admin login, valid tenant subdomain → confirmation page, unclaimed subdomain → 404, suspended tenant → status page, tenant subdomain + `/platform/login` → 404. |
| X. Clean branch per feature | **PASS** | Feature work proceeds on `004-tenant-subdomain-routing`, branched from a clean tree per prior specs' convention. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends `apps/web` (middleware + pages) and `apps/api` (new route module) in place; no new app or framework. Next.js middleware never talks to Postgres directly — all DB access stays in Fastify (Technical Context Constraints). |
| XII. Prefer built-in/native utilities | **PASS** | Host-header parsing is plain string operations; the Next.js→Fastify call uses the built-in `fetch` global; no HTTP client or subdomain-parsing package is added (research.md §5). |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | Technical Context states "None"; the one dependency-shaped option considered (adding Vitest to `apps/web`) was explicitly rejected with reasoning, not silently added. |

No unresolved `[NEEDS CLARIFICATION]` markers remain. All three Clarifications-session decisions
(reserved-word list, Spec 2 amendment, RLS mechanism) are reflected in this plan's Technical Context
and research.md.

## Project Structure

### Documentation (this feature)

```text
specs/004-tenant-subdomain-routing/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── tenant-routing-resolve-api.md
│   └── nextjs-middleware-routing.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure — no new app/package):

```text
apps/api/
├── src/
│   └── tenant-routing/                      # new module, parallel to platform-auth/, provisioning/
│       ├── reserved-subdomains.ts            # new — canonical RESERVED_SUBDOMAINS list (spec FR-005)
│       ├── resolve-tenant.ts                 # new — resolveTenantBySubdomain(): reserved check,
│       │                                     #   then narrow-RLS lookup (research.md §2)
│       └── tenant-routing-routes.ts          # new — GET /tenant-routing/resolve (contracts/)
├── src/provisioning/
│   └── provision-tenant.ts                   # amended — reserved-word check before insert (Spec 2 FR-016),
│                                              #   imports RESERVED_SUBDOMAINS from tenant-routing/
└── drizzle/                                  # amended — new migration on top of 0000-0017
    # 0018  rls_tenants_subdomain_lookup: second SELECT-only permissive policy on tenants,
    #       gated by app.subdomain_lookup (research.md §2; no grant changes needed)

apps/web/
├── middleware.ts                              # new — Host-header extraction, root/platform-path
│                                               #   isolation, calls tenant-routing/resolve, rewrites
├── app/
│   ├── tenant/
│   │   └── page.tsx                           # new — minimal "Welcome to {Tenant Name}" placeholder
│   │                                           #   (valid + active subdomain landing, spec Assumptions)
│   └── tenant-status/
│       └── [state]/
│           └── page.tsx                       # new — distinct suspended/cancelled status page
└── .env.example                                # amended — new ROOT_DOMAIN variable documented
```

**Structure Decision**: Extend `apps/api` and `apps/web` in place, exactly as Specs 1–3 did. Backend
logic lives in a new `apps/api/src/tenant-routing/` module (parallel to `platform-auth/` and
`provisioning/`), plus one amendment to `provisioning/provision-tenant.ts` and one new Drizzle
migration. The frontend logic is a single new `apps/web/middleware.ts` plus two new minimal page
routes under `apps/web/app/`.

## Complexity Tracking

> No Constitution Check violations require justification. Two items are tracked here for
> traceability, matching the posture already established by Specs 1–3.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Build the tenant landing placeholder and suspended/cancelled status page (`apps/web/app/tenant/`, `apps/web/app/tenant-status/`) before the design system is locked | Spec's Constitution Alignment requires a demoable slice for this milestone (Principle IX) | Deferring the whole feature until the design system locks was considered; rejected because the routing/RLS/provisioning backend work has no such dependency and can proceed now — only these two screens' visual build-out should reference the design system once locked, or explicitly flag against it, per Principle V | **Open — flag at implementation time of these screens, same posture already established by every prior UI surface in this codebase** |
| A second permissive RLS policy on `tenants` (alongside the existing `tenant_isolation` policy) rather than one unified policy | The subdomain lookup (pre-auth, cross-tenant by nature) and the existing per-tenant isolation (post-auth, single-row) have genuinely different `USING` conditions that would otherwise require an `OR` clause added to, and re-reasoned about, `0009_rls_tenants.sql` itself | Editing the existing policy in place was considered; rejected because Postgres additive permissive policies (research.md §2) let the new, narrow allowance be reviewed, tested, and (if ever needed) dropped independently of the original tenant-isolation policy, without touching a migration Specs 2 and 3 already depend on | **Resolved — additive migration, no edit to `0009_rls_tenants.sql`** |
| FR-012 (session-tenant vs. subdomain-tenant consistency check) ships as a header-forwarding contract only, not an enforced comparison, in this feature | No tenant-user authentication mechanism exists yet (spec Assumptions) — there is no `request.user.tenantId` on any tenant-scoped request today for this feature's code to compare against, so the check is currently unexercisable by construction, not merely untested | Blocking this entire feature until tenant-user auth ships was considered; rejected because subdomain routing (the actual value of this spec) has no dependency on tenant-user login existing, and the header this check needs (`x-tenant-subdomain`, research.md §4/§8) is cheap to establish now so the future tenant-auth spec only has to add the comparison, not also invent the plumbing | **Open — tracked as a task for the future tenant-user-authentication spec to wire in; flagged here so FR-012 isn't silently treated as "done" by this feature alone** |
