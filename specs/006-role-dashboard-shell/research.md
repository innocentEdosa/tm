# Research: Role-Based Dashboard Shell

## 1. Where the shell lives: a Next.js layout, not a duplicated page

**Decision**: `apps/web/app/dashboard/layout.tsx` (Server Component) owns the persistent sidebar frame;
`apps/web/app/dashboard/page.tsx` is the (currently minimal) content nested inside it.

**Rationale**: The spec's entire point is "the frame every future dashboard page will live inside."
Next.js App Router layouts are exactly this primitive — they persist across client-side navigations
between nested pages without re-fetching/re-rendering the shell. Every future dashboard content page
(team roster, TNA, approvals, etc. — all deferred) nests under `app/dashboard/**` for free once this
layout exists, with zero changes to this feature's code.

**Alternatives considered**: A single page component re-rendering the sidebar itself was rejected —
it would need to be copy-pasted into every future dashboard route instead of inherited automatically.

## 2. Reusing the existing `/tenant-auth/me` endpoint rather than adding a new one

**Decision**: Amend `GET /tenant-auth/me`'s response to additionally include `roleName: string | null`
and `permissions: string[]`, rather than adding a second endpoint.

**Rationale**: `/me` already exists specifically to answer "who is the current session and what's
their state" (Spec 5), is already allowed during `must_change_password: true`, and every call site
that will need role/permission data (the new dashboard layout) already needs everything `/me` already
returns (`email`). Extending one endpoint's shape is simpler than introducing a second one with
overlapping purpose. Existing tests assert individual fields, not exact response shape, so this is a
non-breaking addition (confirmed by inspection of `tenant-auth-otp-forces-change.test.ts` and
`tenant-auth-cross-tenant-session.test.ts`).

**Alternatives considered**: A dedicated `GET /tenant-auth/permissions` endpoint was considered and
rejected as an unnecessary second round trip for data the frontend needs at the exact same moment as
`/me`'s existing fields.

## 3. Deriving role name + permissions: reusing the existing effective-permissions pattern

**Decision**: A new query joins `user_roles` → `roles` → `role_permissions` → `permissions` for the
current user (scoped by `request.tenantDb`, so RLS already restricts it to their own tenant — no new
RLS policy needed), grouped into `{ roleName, permissionKeys }` pairs, then reduced through the
existing `resolveEffectivePermissions()` helper (`apps/api/src/permissions/effective-permissions.ts`,
already used elsewhere) to produce the final `permissions: string[]`. `roleName` is taken from the
first `user_roles` row (ordered by `created_at`) — since the spec's Assumptions state a user holds
exactly one role, this is expected to be the only row in practice; if it isn't, the union of
permissions is still computed correctly across whatever rows exist, so a data anomaly degrades
gracefully instead of crashing.

**Rationale**: `requirePermission()` (`apps/api/src/permissions/require-permission.ts`) already proves
this exact join pattern is correct and RLS-safe; this is the same query shape generalized to return
everything instead of checking one key.

**Alternatives considered**: A per-user materialized/cached permissions column was rejected as
premature optimization — this query runs once per `/me` call, not per-permission-check, and the
existing pattern already performs acceptably at this scale.

## 4. Shell content: a shared `page.tsx`, not a per-role component tree

**Decision**: `app/dashboard/page.tsx` renders one shared "more to come" empty state for every role —
no per-role branching inside the content area at all in this feature.

**Rationale**: Per the narrowed scope (spec.md Clarifications, session 2026-07-04), real per-role
content is entirely deferred. Branching logic for content that doesn't exist yet would be dead code
today and wrong shape once real content specs land (each role's real content will likely need its own
route, e.g. future `app/dashboard/team/page.tsx` for the roster) rather than an if/else inside one page.

**Alternatives considered**: Building empty per-role page shells now (`/dashboard/hr-admin`,
`/dashboard/manager`, `/dashboard/employee`) was rejected — the spec explicitly asks for one shell
users land on regardless of role; only the *sidebar entries* differ by role, not the landing route.

## 5. Sidebar structure: single labeled panel, not the reference image's two-tier rail

**Decision**: The sidebar is one persistent panel (icon + label per entry), not the reference
screenshot's icon-only rail plus separate expanded contextual panel.

**Rationale**: The reference image's two-tier structure exists to organize a *large* number of nested
destinations (Courses/Programs/Subscriptions/Gradebook, an "Others" group, a "Top Courses" list). This
shell has four entries total (Home, Team Members, Authentication Settings, Courses) at launch — a
single panel is the honest amount of chrome for that; a second collapsed rail would be empty
scaffolding with nothing to collapse. The *visual language* (icon + label rows, active-state
highlighting, grouped sections) still takes direct inspiration from the reference image and reuses
the locked design system's colors (`design-system/tm/MASTER.md`) — only the two-tier mechanism itself
is deferred until there are enough destinations to justify it.

**Alternatives considered**: Replicating the full icon-rail + panel mechanism now was rejected as
building UI infrastructure with nothing to put in the second tier yet — it can be introduced later
without disruption once enough real destinations exist to need it.

## 6. Sidebar entries and their permission gates

**Decision**: Four sidebar entries, resolved from the session's `permissions` array:

| Entry | Destination | Visible when | State when not visible |
|---|---|---|---|
| Home | `/dashboard` | always | n/a (always shown, always enabled) |
| Team Members | `/settings/team` | `manage_team_members` present | omitted entirely, not shown disabled |
| Authentication Settings | `/settings/authentication` | `manage_authentication_settings` present | omitted entirely, not shown disabled |
| Courses | *(no destination yet)* | always | shown, disabled, "Coming soon" |

**Rationale**: Team Members and Authentication Settings are real, already-built pages (Spec 5) —
gating them by the exact permission each page's own backend route already requires
(`requirePermission("manage_team_members")` / `requirePermission("manage_authentication_settings")`)
means the sidebar can never link a user to a page that then 403s them. Courses has no backend or page
yet, so it's shown-but-disabled for every role — this is the concrete case that satisfies FR-005 (a
sidebar entry pointing nowhere yet must render disabled, never as a broken link) and also ensures a
user with zero admin permissions (a baseline Employee/Learner) still sees more than just "Home" in
their sidebar (Edge Cases).

**Alternatives considered**: Omitting Courses entirely until it's built was considered, but the spec's
Edge Cases explicitly requires proving the "coming soon" disabled-link pattern works, and a
zero-permission user's sidebar would otherwise contain only one entry, which reads as broken/empty
rather than intentionally minimal.

## 7. Login/redirect entry points to change

**Decision**: Three existing client-side redirect targets change from `/tenant` to `/dashboard`:
`tenant-login-form.tsx`'s successful (non-must-change-password) login, `set-password-form.tsx`'s
successful submission, and `tenant/page.tsx`'s own already-authenticated branch (which now
`redirect()`s to `/dashboard` instead of rendering its own `TenantAuthenticatedView` component, which
is deleted as dead code superseded by the dashboard shell).

**Rationale**: Spec FR-001 requires landing directly on the dashboard shell with no intermediate
generic page — `/tenant`'s bespoke "You're signed in as {email}" confirmation *was* that generic
intermediate page before this feature existed; now that a real shell exists, it's correct to redirect
straight past it rather than keep both.

## 8. A shared server-side session-fetch helper

**Decision**: Extract the "read the `tm_tenant_session` cookie, call `/tenant-auth/me` server-to-server,
branch on the result" logic (currently duplicated across `tenant/page.tsx` and `set-password/page.tsx`)
into one helper, `apps/web/lib/tenant-session.ts`, used by both of those plus the new
`app/dashboard/layout.tsx`.

**Rationale**: This feature adds a third call site of the same logic; extracting it now is a
straightforward de-duplication of code that already exists three times, not new abstraction built
ahead of need.

**Alternatives considered**: Copy-pasting a third time was rejected — the exact pattern (cookie read,
server-to-server fetch, JSON parse, redirect-on-failure) is easy to drift out of sync across three
copies, e.g. if the must-change-password redirect logic ever needs to change.
