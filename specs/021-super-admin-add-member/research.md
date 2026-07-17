# Phase 0 Research: Super Admin Add Member

## §1. Why `roleExists`/`departmentIsActive` cannot be called against `request.superAdminDb`

**Decision**: Add two small, explicitly-tenant-filtered equivalents —
`roleExistsForTenant(db, tenantId, roleId)` and
`departmentIsActiveForTenant(db, tenantId, departmentId)` — local to the new
`add-tenant-member.ts` file, rather than modifying `tenant-auth/team-write-validation.ts`'s existing
`roleExists`/`departmentIsActive`.

**Rationale**: Both existing functions run `tenantDb.select(...).from(roles/departments).where(eq(id, ...))`
with **no** `tenant_id` predicate — correct today only because `request.tenantDb`'s RLS context
already scopes the read to the caller's own tenant. `request.superAdminDb` (Spec 020) has no such
ambient scoping — its `app.tenant_id` is pinned to a nil UUID and the `super_admin_full_access`
policies grant visibility across every tenant. Calling the existing functions unmodified against
`request.superAdminDb` would let a role or department id from *any* tenant validate successfully
regardless of which tenant's `:id` the Super Admin is actually adding the member to — the same class
of cross-tenant leak Spec 020's research.md §1 already identified and worked around for its own reads.

**Alternatives considered**: Adding an optional `tenantId` parameter to the existing
`roleExists`/`departmentIsActive` and threading it through from both call sites. Rejected for this
spec's scope: it would touch `tenant-auth/team-write-validation.ts`, a file Spec 013 owns and no
other part of Spec 020 has needed to modify, for the benefit of a single new call site here — two
short, local, explicitly-filtered functions are simpler to review in isolation and carry zero risk of
changing behavior for the existing tenant-side route.

## §2. Reusing the OTP invite mechanism unchanged

**Decision**: Import `generateOneTimePassword`/`otpExpiryFromNow` (`tenant-auth/otp.ts`),
`hashPassword` (`platform-auth/password.ts`), and `sendMemberInviteEmail` (`tenant-auth/mailer.ts`)
directly — no new password-generation primitive, unlike Spec 020's own password-reset action.

**Rationale**: Spec 020's reset-password action deliberately duplicated the random-token primitive
rather than importing `generateOneTimePassword` directly, because the two features' semantics
diverged (a permanent, not-forced-to-change credential vs. a one-time, forced-to-change one — Spec
020 research.md §4). Here the semantics match exactly: a brand-new member needs a real OTP, forced
change at first login, and the existing branded invite email — so importing the existing functions
directly is the correct reuse, not a duplicate-with-different-name situation.

## §3. `sendMemberInviteEmail` never throws — no special error handling needed

**Decision**: Call `sendMemberInviteEmail` directly after the member/role rows are committed, with no
`try`/`catch` specifically around it (beyond whatever the surrounding handler already has for its own
queries).

**Rationale**: `tenant-auth/mailer.ts`'s internal `sendMail` function already catches and
`console.error`s any send failure itself, and returns early (with a `console.warn`) if no mail
provider is configured — its own doc comment states this explicitly: "Callers... MUST NOT let a
rejection here fail the operation that triggered it." `sendMemberInviteEmail` therefore cannot reject.
The existing `POST /tenant-auth/team` route wraps its call in a `try`/`catch` anyway (defensively
covering the adjacent `tenants.name` lookup in the same block) — this plan does the same, for the
same defensive reason, not because the email call itself can fail the request.

## §4. No new RLS policy needed

**Decision**: No new migration. Confirmed by reading the already-shipped migrations
(`0062_super_admin_full_access_user_roles.sql`, `0063_super_admin_full_access_users.sql`): both
already carry `WITH CHECK (current_setting('app.is_super_admin', true) = 'true')`, which permits an
`INSERT` from a Super Admin session on both tables. This feature's one and only new database
operation (inserting a `users` row and a `user_roles` row) is already covered.

**Rationale/Verification**: Spec 020 added these policies primarily to support its password-reset
action's `UPDATE` on `users` and its various `SELECT`s — but Postgres RLS `WITH CHECK` clauses gate
every write command (`INSERT`, `UPDATE`) uniformly once written without a command-specific qualifier,
and neither migration restricts itself to `UPDATE` only. This was the one open item explicitly flagged
in the feature description as needing confirmation before assuming no new policy was required — it is
now confirmed, not assumed.

## §5. Frontend: form location and shape

**Decision**: An "Add Member" button on the console's Members tab
(`apps/web/app/(platform-shell)/tenants/[tenantId]/page.tsx`), opening a `Modal` with `fullName`,
`email`, `roleId` (a `<select>` populated from the same `roles` data already fetched for the Roles
tab), and `departmentId` (optional, populated from the same `departments` data already fetched for
the Departments tab).

**Rationale**: Reuses data already being fetched by the existing tabs rather than adding new GET
calls — the Roles and Departments tabs' data is already loaded (or loadable via the same existing
`GET /tenants/:id/roles` / `GET /tenants/:id/departments` routes) by the time a Super Admin opens
this form. Matches the existing Modal-based form pattern already used by this same page's
password-reset flow, and by Spec 013's own tenant-side Add Member form.

**Alternatives considered**: A dedicated "Add Member" page/route. Rejected — this is a small,
single-purpose form well within a Modal's established role in this codebase (Spec 020's own research
§7 already drew this same line between "Modal for a short form" vs. "dedicated page for a
multi-section view").
