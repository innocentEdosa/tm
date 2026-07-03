# Implementation Plan: Super Admin Authentication

**Branch**: `003-super-admin-authentication` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-super-admin-authentication/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a platform-level Super Admin identity and login flow, entirely separate from tenant-scoped
users: a `super_admins` table (no `tenant_id`, no `INSERT` grant for the running server — only a
standalone seed script can create one), a `super_admin_sessions` table storing only a hash of each
session token, and a dedicated `/platform/login` → `/platform/me` flow gated by a
`super-admin-context` Fastify plugin that mirrors Spec 1's `tenant-context.ts` idiom to set
`app.is_super_admin` per request. This supersedes Spec 1's `roles.tenant_id IS NULL` +
`tm_platform_reader` `BYPASSRLS` mechanism going forward (Clarifications); migrating Spec 1/2's
existing call sites to it is explicit follow-up work, not part of this plan. No new dependencies —
password hashing, cookie handling, and rate-limit tracking are all built on Node's standard library
and the already-installed Fastify/Drizzle/Postgres stack.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 (per `.nvmrc`), matching `apps/api`'s existing
`packages/tsconfig/node.json` config — unchanged from Specs 1–2.

**Primary Dependencies**: Fastify 5, `@fastify/cors`, `@fastify/postgres`, `drizzle-orm`, `pg` — all
already installed. `apps/web`'s Next.js app, unchanged.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Password
hashing uses `node:crypto`'s built-in `scrypt`; session cookies are read/written with a small
hand-rolled helper (not `@fastify/cookie`); rate-limit state is plain Drizzle-managed columns (not
`@fastify/rate-limit`); session tokens use `node:crypto`'s `randomBytes`. See research.md §1 for why
each of these is judged sufficiently simple/well-bounded to not need a package.

**Storage**: PostgreSQL — the same database Specs 1–2's tables live in. Two new, platform-global
tables (`super_admins`, `super_admin_sessions`); no schema change to any existing table.

**Testing**: Vitest, matching Specs 1–2's `apps/api/tests/integration/` convention — real Postgres
connection, no mocks, since grant-level guarantees (research.md §7) and session-hash lookups can't be
verified as "actually enforced" against a mock.

**Target Platform**: Linux server (Railway), long-running Fastify process — unchanged from prior specs.

**Project Type**: Web-service (backend primitive: three new routes, two new tables, one standalone
script) with two new minimal Next.js screens (login page, authenticated landing confirmation) as this
feature's demoable slice.

**Performance Goals**: No hard SLA specified by the spec. SC-001's "under 2 minutes" is a
human-in-the-loop UX target (seed script → login), not a request-latency target. `scrypt` is
deliberately CPU/memory-hard (that's the point of using it for password hashing) — login latency on
the order of tens to low-hundreds of milliseconds per attempt is expected and acceptable at Super
Admin's inherently low request volume; this is a working assumption, not a contractual target.

**Constraints**: The running server's Postgres role (`tm_app`) MUST NOT be granted `INSERT` on
`super_admins` (research.md §7) — this is a hard constraint the migration's grants must encode, not
just an application-layer convention. Session tokens MUST be stored only as a hash, never in plaintext
(research.md §2). The Super Admin session cookie MUST be scoped to `Path=/platform` (research.md §3).

**Scale/Scope**: Expected to be a small handful of Super Admin accounts (internal Handiwoker staff),
not a scale-sensitive path. Three new backend routes, two new tables, one standalone script, two new
frontend pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | `super_admins`/`super_admin_sessions` have no tenant dimension by design (not a violation — there is nothing to isolate). This spec *strengthens* Principle I platform-wide by establishing an RLS-allowance-clause mechanism (FR-012/013) that future tenant-scoped tables can use instead of a `BYPASSRLS` role — the exact anti-pattern Spec 1 had to reach for (research.md §5, §7). |
| II. Tenant provisioning includes org structure | N/A | This spec is platform-level, not tenant provisioning. |
| III. Forms/flows are tenant-configurable | N/A | No tenant-facing form or approval flow is touched. |
| IV. Spec-before-code | **PASS** | Follows the ratified, clarified spec.md; all three Clarifications decisions (supersede Spec 1's mechanism; fixed-path login; server-side revocable sessions) are threaded through this plan, not invented here. |
| V. Design system (locked via UI-UX-Pro-Max) | **DEFERRED** | Still not locked. The two new UI surfaces (login page, landing confirmation) follow the same "pending a fully locked design system" posture already used by every prior UI surface in this codebase — tracked in Complexity Tracking below. |
| VI. Plan-tier awareness | N/A | Super Admin auth is not tier-gated — it is platform-operator infrastructure, available uniformly. |
| VII. White-labeling & structural customization | N/A | No tenant-owned structure or branding is touched. |
| VIII. Comprehensive-version rule | **PASS** | Server-side revocable sessions (more complete/secure than a bare stateless token) and explicitly superseding Spec 1's mechanism (rather than letting two Super-Admin-verification paths coexist silently and indefinitely) were both chosen as the more complete option and confirmed via Clarifications, not decided silently here. |
| IX. Demoable vs. internal | **PASS** | Explicitly demoable per spec.md: seed script → login → landing confirmation, end to end. |
| X. Clean branch per feature | **PASS** | Branch `003-super-admin-authentication` was created from a clean `master` (Spec 2 already merged) before any spec work began. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends the existing `apps/api` (Fastify) and `apps/web` (Next.js) apps in place; no new app or framework. |
| XII. Prefer built-in/native utilities | **PASS** | `node:crypto` (`scrypt`, `randomBytes`) for hashing/tokens, a hand-rolled cookie helper, and Drizzle-managed columns for rate-limit state — no package reached for where a built-in or already-installed tool suffices (research.md §1). |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | Technical Context states "None"; no install command is proposed. |

No unresolved `[NEEDS CLARIFICATION]` markers remain. All three Clarifications-session decisions are
reflected in this plan's Technical Context and research.md.

## Project Structure

### Documentation (this feature)

```text
specs/003-super-admin-authentication/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── platform-auth-api.md
│   └── seed-super-admin-script.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure — no new app/package):

```text
apps/api/
├── src/
│   ├── db/
│   │   └── schema/
│   │       └── super-admins.ts          # new — super_admins + super_admin_sessions tables
│   └── platform-auth/                    # new module, parallel to permissions/ and provisioning/
│       ├── password.ts                    # new — scrypt hash/verify helpers (research.md §1)
│       ├── cookies.ts                     # new — parse/serialize the session cookie (research.md §3)
│       ├── session.ts                     # new — token generation + hashing (research.md §2)
│       ├── super-admin-context.ts         # new — mirrors plugins/tenant-context.ts (research.md §6)
│       ├── require-super-admin-session.ts # new — preHandler guard for protected routes
│       └── platform-auth-routes.ts        # new — POST /platform/login, /logout, GET /platform/me
├── scripts/
│   └── seed-super-admin.ts               # new — standalone CLI, uses DATABASE_URL directly (research.md §7-8)
└── drizzle/                               # amended — new migrations on top of 0000-0016
    # 0017  init super_admins + super_admin_sessions tables (no RLS — no tenant_id)
    # 0018  tm_app grants: SELECT/UPDATE only on super_admins (no INSERT), SELECT/INSERT/UPDATE on super_admin_sessions

apps/web/
└── app/
    └── platform/
        ├── login/
        │   └── page.tsx                   # new — Super Admin login form
        └── page.tsx                        # new — authenticated landing confirmation (calls GET /platform/me)

packages/types/src/index.ts                # existing — reused as-is; no new shared type required
```

**Structure Decision**: Extend `apps/api` and `apps/web` in place, exactly as Specs 1–2 did. Backend
logic lives in a new `apps/api/src/platform-auth/` module (parallel to `permissions/` and
`provisioning/`, with no import dependency on either — this spec is explicitly independent of
tenant-related code), plus one new Drizzle schema file and one standalone script outside the Fastify
app entirely. The two new UI surfaces live under `apps/web/app/platform/`.

## Complexity Tracking

> No Constitution Check violations require justification. One governance item is tracked here for
> traceability, matching the posture already established by Specs 1–2's own UI surfaces.

| Item | Why Needed | Simpler Alternative Rejected Because | Status |
|------|------------|---------------------------------------|--------|
| Build the login page and landing confirmation (`apps/web/app/platform/`) before the design system is locked | Spec's Constitution Alignment requires a demoable slice for this milestone (Principle IX) | Deferring the whole feature until the design system locks was considered; rejected because the backend primitive (tables, routes, session mechanism) has no such dependency and can proceed now — only these two screens' visual build-out should reference the design system once locked, or explicitly flag against it, per Principle V | **Open — flag at implementation time of these screens, same posture already established by every prior UI surface in this codebase** |
