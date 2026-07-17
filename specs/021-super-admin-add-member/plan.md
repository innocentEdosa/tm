# Implementation Plan: Super Admin Add Member

**Branch**: `021-super-admin-add-member` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-super-admin-add-member/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add one new route, `POST /tenants/:id/members`, to the existing
`apps/api/src/super-admin-tenant-console/super-admin-tenant-console-routes.ts` (Spec 020), backed by
a new `add-tenant-member.ts` handler in the same module. The handler is a straight port of the
existing `POST /tenant-auth/team` handler's logic (Specs 012/013) onto `request.superAdminDb` with
one structural change carried over from Spec 020's own research.md §1 lesson: `roleExists` and
`departmentIsActive` (`tenant-auth/team-write-validation.ts`) rely on `request.tenantDb`'s ambient
RLS scoping and take no `tenant_id` parameter, so they cannot be called against
`request.superAdminDb` without leaking across tenants — this plan adds two small,
explicitly-tenant-filtered equivalents local to the new handler file rather than modifying the
existing tenant-scoped helpers. Every other piece is reused unchanged: `generateOneTimePassword`/
`otpExpiryFromNow` (`tenant-auth/otp.ts`), `hashPassword` (`platform-auth/password.ts`), and
`sendMemberInviteEmail` (`tenant-auth/mailer.ts`) — the last of which already never throws (its
internal `sendMail` swallows and logs a failure, per its own doc comment), so this handler needs no
special error handling around the email step beyond what the existing route already does. No new RLS
policy: `users` and `user_roles` already carry Spec 020's `super_admin_full_access` policy with a
`WITH CHECK` clause that already permits `INSERT`. `users.invited_by` is left `NULL` (a Super Admin
has no tenant-scoped `users.id`). Logs to the existing `member_action_log` table (Spec 020) with a new
`action: "member_added"` value — no schema change, since that column is free text, not an enum.
Frontend: an "Add Member" button + a small Modal form on the console's existing Members tab
(`apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`).

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 — unchanged.

**Primary Dependencies**: Fastify 5, `drizzle-orm`, `pg` on the API side; Next.js App Router +
`@tm/ui` (`Modal`, `Input`, `Button`) on the web side — all already installed and already used by
Spec 020's console page and Specs 012/013's own Add Member form.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: None. Every piece
this feature needs — OTP generation, password hashing, email sending, the member-creation write
itself — already exists and is reused, not reinvented.

**Storage**: PostgreSQL, shared schema with RLS — unchanged. No new table, no new column, no new RLS
policy (confirmed in spec.md's Constitution Alignment: the existing `super_admin_full_access` policies
on `users`/`user_roles` from Spec 020 already permit the `INSERT` this feature performs).

**Testing**: Vitest, matching `apps/api/tests/integration/`'s existing convention. The one behavior
that must be proven against a real Postgres connection (not assumed from reading the existing
tenant-side route) is that the new tenant-filtered `roleExists`/`departmentIsActive` equivalents
actually reject a role/department belonging to a *different* tenant — the same class of regression
Spec 020's own cross-tenant-isolation tests targeted.

**Target Platform**: Linux server (Railway) for `apps/api`; Next.js/Railway for `apps/web` —
unchanged.

**Project Type**: Web-service (one new backend route) plus one new form/Modal on an existing Next.js
page (Spec 020's console) as this feature's demoable slice.

**Performance Goals**: No hard SLA specified by the spec. SC-001 (add a member in under one minute)
is a UX target dominated by human form-filling time, not query cost — this is a single-row insert plus
two small existence-check queries, the same cost shape as the existing tenant-side route.

**Constraints**: The new handler MUST filter every query by the route's own `:id` (tenant) param
explicitly — never relying on `request.superAdminDb`'s ambient RLS context, which is tenant-agnostic
by design (Spec 020 Summary/research.md §1). This is the one discipline every task in this plan must
not skip, same as every other route Spec 020 already added.

**Scale/Scope**: One new route handler, two small local validation helpers, one new frontend form.
No changes to any existing route's contract — `POST /tenant-auth/team` (the tenant-side equivalent)
remains byte-for-byte unchanged.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Tenant isolation is a security requirement | **PASS** | No new RLS policy — reuses Spec 020's existing `super_admin_full_access` `WITH CHECK` on `users`/`user_roles`. The new route explicitly filters every query by the route's `:id` param (research.md §1) rather than relying on ambient RLS scoping; the new role/department existence checks are tenant-filtered explicitly, unlike the tenant-side helpers they're modeled on. |
| II. Tenant provisioning includes org structure | N/A | This feature adds a member to an already-provisioned tenant's already-existing role/department catalog; it provisions nothing new. |
| III. Forms/flows are tenant-configurable | N/A | The Add Member form is platform-internal Super Admin tooling operating on a tenant's already-configured roles/departments — no new configurable entity is introduced. |
| IV. Spec-before-code | **PASS** | This plan follows the ratified spec.md; its one clarification (tenant-status scope — fully available regardless of status) is recorded in spec.md's Clarifications section, not invented here. |
| V. Design system (locked via UI-UX-Pro-Max) | **PASS** | Reuses the same `Modal`/`Input`/`Button` components already proven by Spec 020's console page and Spec 013's own Add Member form — no ad hoc styling. |
| VI. Plan-tier awareness | N/A | No plan-tier/feature-flag concept is introduced. |
| VII. White-labeling & structural customization | N/A | No branding, department, permission, form, or workflow structure is touched — this feature only creates a member row using a tenant's already-configured role/department. |
| VIII. Comprehensive-version rule | N/A | No conflicting-scope tradeoff surfaced during planning; the one spec clarification was resolved directly with the stakeholder in `/speckit-specify`. |
| IX. Demoable vs. internal | **PASS** | Spec.md states this is stakeholder-demoable — adding a member to any tenant from the console is the demoable slice. |
| X. Clean branch per feature | **PASS (pending)** | No `before_specify`/`before_plan` git hook is registered (`.specify/extensions.yml` does not exist) — same gap already flagged in the constitution's own Sync Impact Report and in every prior spec's plan in this repo. Working tree was clean of unrelated changes when this plan was authored. |
| XI. Stack is fixed (Next.js/Fastify) | **PASS** | Extends the existing `apps/api` (Fastify) and `apps/web` (Next.js) apps in place. |
| XII. Prefer built-in/native utilities | **PASS** | Reuses `generateOneTimePassword`, `hashPassword`, and `sendMemberInviteEmail` unchanged rather than introducing new primitives; only the two tenant-filtered existence checks are new code, and those are minimal, explicitly-filtered variants of an existing, well-understood pattern. |
| XIII. No new package without explicit permission | **PASS — nothing to approve** | No new dependency is proposed anywhere in this plan. |

No unresolved `[NEEDS CLARIFICATION]` markers remain in Technical Context. The one spec-level
clarification was resolved directly in `/speckit-specify` before this plan was written.

## Project Structure

### Documentation (this feature)

```text
specs/021-super-admin-add-member/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/             # Phase 1 output (/speckit-plan command)
│   └── super-admin-add-member-api.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Existing pnpm/Turborepo monorepo (unchanged top-level structure):

```text
apps/api/
└── src/
    ├── super-admin-tenant-console/
    │   ├── add-tenant-member.ts                    # new — POST /tenants/:id/members handler,
    │   │                                             #       incl. local roleExistsForTenant /
    │   │                                             #       departmentIsActiveForTenant helpers
    │   ├── errors.ts                                # amended — + RoleNotFoundError,
    │   │                                             #           DepartmentNotActiveError,
    │   │                                             #           EmailConflictError
    │   └── super-admin-tenant-console-routes.ts     # amended — registers the new route
    └── (no schema/migration changes — data-model.md)

apps/web/
└── app/(platform-shell)/tenants/[tenantId]/
    └── page.tsx                                    # amended — "Add Member" button + form Modal
                                                      #           on the Members tab
```

**Structure Decision**: No new module — this feature is a single additional route in Spec 020's
existing `super-admin-tenant-console` module, and a single additional form on Spec 020's existing
console page. No new top-level directory, no new database migration.

## Complexity Tracking

*No Constitution Check violations — this section is not needed.*
