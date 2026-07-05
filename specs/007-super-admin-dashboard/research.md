# Research: Super Admin Platform Dashboard Shell

## 1. No backend changes needed at all

**Decision**: This feature makes zero changes to `apps/api`.

**Rationale**: Inspection of the three existing endpoints this shell surfaces confirms each already
returns everything the shell needs:
- `GET /platform/me` already returns `{ id, email, name, lastLoginAt, isSuperAdminFlagSet }` —
  exactly the identity summary FR-005 requires, already consumed by today's `app/platform/page.tsx`.
- `POST /provisioning/tenants` (existing Tenant Provisioning Core spec) is already fully implemented
  and already consumed by `app/provisioning/new/page.tsx` — this feature does not touch it.
- `GET /admin/permissions` / `GET /admin/role-templates` (existing Roles & Permissions Model spec) are
  already fully implemented and already consumed by `app/admin/permissions/page.tsx` — unchanged here.

This is a purely additive frontend restructuring: a new shell (layout + sidebar) wrapping existing,
unmodified pages, plus a new shared session-fetch helper. No migration, no new route, no new
dependency.

## 2. Route group mirrors the tenant-side pattern exactly

**Decision**: A new route group `app/(platform-shell)/` wraps the home page, the provisioning
wizard, and the permissions catalog — mirroring `app/(dashboard-shell)/` from the Role-Based
Dashboard Shell spec. `app/platform/login/page.tsx` stays outside the group, unwrapped (mirrors
`app/tenant/page.tsx` — the tenant login page — staying outside `(dashboard-shell)`).

**Rationale**: Same reasoning as the tenant-side spec: a persistent shell only makes sense if it
actually persists across every page it links to. Route groups keep URLs unchanged (`/platform`,
`/provisioning/new`, `/admin/permissions` all stay exactly where they are today) while sharing one
layout.

## 3. Separate implementation, not a shared component with the tenant shell

**Decision**: `platform-sidebar.tsx` and `lib/platform-session.ts` are new, separate files — not a
shared component imported by both the tenant and platform shells.

**Rationale**: The two shells read different session cookies (`tm_super_admin_session` vs.
`tm_tenant_session`), call different `/me` endpoints with different response shapes, and — critically
— the platform shell has no permission-gating concept at all (a Super Admin is a single flat role;
FR-002/FR-003/FR-004 apply unconditionally to every Super Admin), whereas the tenant sidebar's entries
are conditionally shown per-user based on the tenant roles/permissions model. Forcing one shared
component to cover both would need branching for a distinction (permission-gated vs. always-shown)
that doesn't actually exist on the platform side. The two *do* share the same CSS: `globals.css`'s
`.sidebar-rail`, `.sidebar-panel`, `.sidebar-panel-item`, etc. classes (added in the tenant-shell spec)
are already generic, not tenant-specific — this feature reuses them as-is, adding zero new CSS classes.

## 4. Sidebar shape: Home direct link + one "Platform Tools" category

**Decision**: Rail entries: **Home** (direct link to `/platform`, no panel — same treatment as the
tenant shell's Home), **Platform Tools** (a category whose panel lists **Provision Tenant** and
**Permissions** as its two items), a collapse toggle, and Log out.

**Rationale**: Neither Provision Tenant nor Permissions has any sub-items of its own — putting each
directly on the rail with its own always-empty panel would never actually exercise the two-tier
mechanism the user asked to mirror. Grouping them under one category reproduces the exact shape
already proven on the tenant side (one direct-link Home + one real category with multiple items),
rather than technically having "a panel" that never opens. This is a UX grouping choice, not a
reflection of any real product taxonomy — worth revisiting once more platform-level capabilities
exist and a different grouping becomes more natural.

## 5. No permission gating — every Super Admin sees every entry

**Decision**: Unlike the tenant sidebar (whose entries are filtered by the logged-in user's
permissions), the platform sidebar shows Home, Platform Tools, Provision Tenant, and Permissions
unconditionally for every authenticated Super Admin.

**Rationale**: There is no platform-level permissions/roles system distinguishing one Super Admin
from another today (confirmed: `super_admins` has no role/permission columns, and every
`requireSuperAdminSession`-guarded route grants access identically to any valid Super Admin session).
Building conditional visibility for a distinction that doesn't exist would be speculative.

## 6. Restyling scope: presentation only, zero logic changes

**Decision**: `provisioning/new/page.tsx` and `admin/permissions/page.tsx` are restyled to use the
locked design system's existing classes (`field-input`, `field-label`, `field-error`, `field-hint`,
`btn`/`btn-primary`/`btn-outline`, `surface-card`, `banner-error`/`banner-success`, `sidebar-*`) in
place of their original ad hoc `gray-*`/`blue-600` Tailwind classes. All state, validation functions,
fetch calls, and step-flow logic are copied over unchanged (FR-003, FR-004, SC-003).

**Rationale**: These pages already work correctly end-to-end (they predate the design system lock).
The only defect being fixed is visual inconsistency and undiscoverability, not behavior.
