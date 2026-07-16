# Phase 0 Research: Super Admin Tenant Console

## §1. Why the existing `tenant-department-routes.ts` query helpers cannot be reused as-is

**Decision**: Write new, explicitly-tenant-filtered read queries in the new
`super-admin-tenant-console/` module rather than importing `department-hierarchy.ts`'s
`findAncestorChain`/`collectSubtreeIds`/`hasChildren`, or the inline `GET /tenant/departments`
handler's own query body.

**Rationale**: Every one of those existing queries is written as `request.tenantDb.select().from(...)`
with **no** `WHERE tenant_id = ...` clause at all — by design, because `request.tenantDb`'s RLS
context (`app.tenant_id` set to the calling tenant user's own tenant) already scopes every row
implicitly. `request.superAdminDb` is fundamentally different: `super-admin-context.ts` pins
`app.tenant_id` to the nil UUID (a documented workaround for a Postgres backend-reuse GUC-poisoning
bug — see that file's own comment) and sets `app.is_super_admin = true`. The five new
`super_admin_full_access` policies this feature adds (§3 below) grant that connection visibility into
**every** tenant's rows on the affected tables, not one. If this feature's routes reused
`request.tenantDb`-style queries verbatim against `request.superAdminDb`, they would silently return
every tenant's departments/roles/members mixed together instead of the one tenant named in the
route's `:id` param — a cross-tenant data leak, exactly the class of bug Constitution Principle I
exists to prevent.

**Alternatives considered**:
- *Set `app.tenant_id` to the target tenant for the duration of this request, then reuse the existing
  `request.tenantDb`-style queries unmodified.* Rejected: this would require minting a
  tenant-context-scoped connection from inside a Super-Admin-authenticated request, which is exactly
  the "assume a tenant session" shape the spec explicitly rules out (FR-015 — no impersonation), and
  would make it easy to accidentally leave `app.tenant_id` set to a stale value on a pooled connection
  reused by a later request (the precise bug class `super-admin-context.ts`'s nil-UUID pin already
  works around once).
- *Refactor the existing helpers to accept an optional explicit `tenantId` filter, used by both tenant-
  user routes and this feature.* Rejected as unnecessary scope growth for this spec: those helpers are
  recursive CTEs tuned for Department Management's cycle/depth-cap checks, which this feature's
  read-only console does not need (no create/edit/delete here, so no cycle or depth validation) —
  duplicating the two or three lines each read actually needs is simpler and safer than threading a new
  parameter through code this feature doesn't otherwise touch (constitution guidance: no premature
  abstraction).

## §2. Why `getRoleMemberCounts` (from `permissions/role-member-counts.ts`) IS safely reusable unmodified

**Decision**: Call the existing `getRoleMemberCounts(db)` directly from
`get-tenant-roles.ts`, passing `request.superAdminDb!`.

**Rationale**: Its query is `SELECT role_id, count(*) FROM user_roles GROUP BY role_id` — no
`tenant_id` filter, but also no tenant-crossing risk, because a given `role_id` is a UUID that
belongs to exactly one tenant by construction (`roles.tenant_id` is set once at role creation and
never crosses rows). Calling this against `request.superAdminDb` returns a map keyed by every role's
id, across every tenant — but this feature only ever looks up counts for the specific `roleId`s
already returned by this feature's own tenant-filtered `roles` query, so no other tenant's counts are
ever read out of the map. This is the one existing helper in this area safe to reuse verbatim; every
other helper touched in §1 is not, because those return full *rows* (departments, users) rather than
counts keyed by an already-unique id.

## §3. RLS extension pattern — five new `super_admin_full_access` policies

**Decision**: Add one additive permissive policy per table — `departments`, `roles`,
`role_permissions`, `user_roles`, `users` — identical in shape to the two already shipped for Tenant
Management (015):

```sql
CREATE POLICY "super_admin_full_access" ON "<table>"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
```

Each table's existing `tenant_isolation` policy (0002, 0003, 0004, 0010, 0011) is left completely
unedited. `permissions` and `role_templates`/`role_template_permissions` need no new policy — they
already have no RLS at all (platform-global catalogs, unchanged by this feature).

**Rationale**: This is the exact precedent Spec 004 established (a narrow, server-set-flag-gated
allowance clause instead of a `BYPASSRLS` role) and Tenant Management (015) already reused twice
(`tenants`, `user_sessions`). Reusing the identical shape a third and fourth time keeps the pattern
uniform and auditable — anyone reviewing RLS policies across the schema sees the same two-line idiom
every time a Super-Admin cross-tenant read/write path was added, rather than a bespoke variant per
table.

**Alternatives considered**:
- *A `SELECT`-only policy for `departments`/`roles`/`role_permissions`/`user_roles` (read-only in this
  feature) and a full `USING`/`WITH CHECK` policy only for `users` (the one table this feature
  writes to).* Considered, since Spec 004's own subdomain-lookup policy is `SELECT`-only precisely
  because that use case never writes. Rejected in favor of matching 0054/0055's shape exactly
  instead: Postgres RLS policies are not natively scoped by SQL command "read vs. write intent" in a
  way that maps cleanly onto "this feature's routes happen to only SELECT here" — the same blanket
  `USING`/`WITH CHECK` shape at the RLS layer, with **write access actually withheld at the
  application layer** (this feature's route handlers simply never issue an `UPDATE`/`INSERT`/`DELETE`
  against `departments`/`roles`/`role_permissions`/`user_roles`), is exactly how 0054/0055 already
  work — `tenants`' policy is nominally read/write capable at the RLS layer even though 0054's own
  comment describes it as backing a "list all tenants" read console, with the actual write endpoints
  (edit/archive/downgrade/delete) being separate, deliberate application-layer decisions. Keeping the
  RLS shape uniform avoids a one-off variant that a future feature might copy incorrectly.
- A `BYPASSRLS` role. Rejected outright — Constitution Principle I and the Super Admin Authentication
  spec (003) both explicitly rule this out; every prior Super-Admin cross-tenant read path in this
  codebase uses the allowance-flag pattern instead.

## §4. Password generation

**Decision**: A new one-line helper in the new module
(`super-admin-tenant-console/generate-password.ts`):

```ts
import { randomBytes } from "node:crypto";

export function generateResetPassword(): string {
  return randomBytes(9).toString("base64url");
}
```

hashed via the existing `hashPassword` (`platform-auth/password.ts`, scrypt-based) before being
written to `users.password_hash`; the plaintext return value is included in the API response once and
never persisted anywhere.

**Rationale**: This is character-for-character the same primitive already used by
`tenant-auth/otp.ts`'s `generateOneTimePassword` (`randomBytes(9).toString("base64url")` — a
12-character URL-safe random string). Rather than importing that function directly across modules for
an unrelated purpose (an OTP is semantically tied to `otpExpiresAt`/forced-change-at-login; this
reset is a permanent credential the member is *not* forced to change — spec Clarifications), this
plan duplicates the same one-line primitive locally under an accurately-named function. This is
consistent with the project's guidance to prefer a few similar lines over a premature shared
abstraction when the two call sites carry different semantics, while still reusing (not
reinventing) the proven underlying `node:crypto` approach.

**Alternatives considered**: Importing `generateOneTimePassword()` directly. Rejected only for the
naming/semantic-drift reason above — the underlying implementation is intentionally identical.

## §5. Member session invalidation

**Decision**: Add `revokeUserSessions(db, { tenantId, memberId })` to the existing
`tenant-management/revoke-tenant-sessions.ts` file, alongside the current
`revokeTenantSessions(db, tenantId)`:

```ts
export async function revokeUserSessions(
  db: Db,
  params: { tenantId: string; memberId: string },
): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessions.tenantId, params.tenantId),
        eq(userSessions.userId, params.memberId),
        isNull(userSessions.revokedAt),
      ),
    );
}
```

**Rationale**: Identical shape and same file as the existing tenant-wide revoke used by
archive/delete (015) — the only difference is an added `userId` predicate to scope to one member
instead of an entire tenant. Both `tenantId` and `memberId` are included in the `WHERE` (not
`memberId` alone) for the same reason every other route in this feature filters explicitly by the
route's tenant param (§1) — defense in depth against a `memberId` that does not actually belong to
the tenant named in the URL.

## §6. Logging — a new `member_action_log` table, not an extension of `tenant_action_log`

**Decision**: A new table, `member_action_log` (id, `tenant_id` nullable/`ON DELETE SET NULL`,
`member_id` nullable/`ON DELETE SET NULL` → `users.id`, `super_admin_id` nullable/`ON DELETE SET NULL`
→ `super_admins.id`, `action` text NOT NULL, `created_at`) — same no-RLS,
Super-Admin-route-only-access posture as `tenant_action_log`, same append-only grant treatment
(`GRANT SELECT, INSERT` only, no `UPDATE`/`DELETE`).

**Rationale**: `tenant_action_log`'s existing shape has no member/user column at all — it records
actions *about a tenant* (edit, archive, downgrade, delete), not actions *about one of a tenant's
members*. Adding a nullable `member_id` column to that table to shoehorn in this feature's one action
would blur its documented meaning ("Tenant Management action") for every future reader and every
future audit-log UI built on top of it. A second, parallel table with the same proven shape keeps both
logs semantically clean without adding any new mechanism (same RLS posture, same grant lock-down
migration idiom as 0056).

**Alternatives considered**: Reusing `tenant_action_log` with a new nullable `member_id` column and a
new `"password_reset"` action value. Rejected for the clarity reason above — the cost of one more
small table is lower than the cost of overloading an existing one's meaning.

## §7. Frontend routing

**Decision**: `apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx` — a new dynamic route
nested under the existing `tenants/` directory, alongside the existing static `tenants/new/page.tsx`.
Next.js resolves a literal segment (`new`) with higher priority than a dynamic segment
(`[tenantId]`) at the same level, so no routing collision exists between "Add Tenant" and any real
tenant id. The existing Tenants list page (`tenants/page.tsx`) gains one new row action ("Manage"),
alongside its existing Edit/Archive/Downgrade/Delete menu items, linking to `/tenants/:id`.

**Rationale**: Matches the spec's explicit requirement that this console is reached only via a row
action on the existing list (Assumptions) — no new top-level sidebar entry. A dedicated page (rather
than a Drawer, which the existing Edit action already uses for a short form) is warranted because this
console has four distinct sections' worth of content — company details, departments, roles, members —
which does not fit the Drawer's established "short form" role in this codebase.

**Alternatives considered**: A modal/drawer with internal tabs. Rejected — the existing Drawer
component in this codebase is used for the Edit form's handful of fields; stretching it to hold four
data-heavy sections (a department tree, a role/permission table, a paginated member list) would be a
novel, larger use of that component than any existing spec has needed, whereas a dedicated route reuses
the exact `PageHeader` + section-composition pattern already established by every top-level page in
this shell.

## §8. Same-origin API proxy — no new work, just discipline

**Decision**: Every fetch the new `[tenantId]/page.tsx` page makes uses the existing
`/platform-api/*` prefix (`API_BASE = "/platform-api"`, matching `tenants/page.tsx`'s own constant),
which `apps/web/next.config.ts` already rewrites to `apps/api`.

**Rationale**: This is the fix already in place platform-wide for the Super Admin session cookie's
cross-origin/third-party-cookie problem (Super Admin Authentication spec's own resolved gap). No new
proxy configuration is needed — this feature's only obligation is to not regress it by fetching a
direct `API_ORIGIN`/absolute URL from any new client code, the same discipline every prior Super Admin
page already follows.
