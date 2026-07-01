# Quickstart: Validating the Roles & Permissions Model

Prerequisites: local Postgres running via `docker-compose.yml` (`docker compose up postgres`),
`apps/api` dependencies installed (including `drizzle-orm`, `drizzle-kit`, and `vitest` — approved
new dependencies, see plan.md), migrations applied via the `drizzle-kit`-generated migration command
(exact command defined in tasks.md).

## 1. Verify the platform catalog is seeded and read-only

```bash
# As the app's runtime DB role (not the migration role):
psql "$DATABASE_URL" -c "SELECT key, category FROM permissions ORDER BY key;"
psql "$DATABASE_URL" -c "SELECT key, is_platform_only FROM role_templates ORDER BY key;"

# Confirm the app role cannot write to the catalog (expect a permission-denied error):
psql "$DATABASE_URL" -c "INSERT INTO permissions (key, display_name, description, category) VALUES ('x','x','x','x');"
```
**Expected**: the two `SELECT`s return the four default role templates
(`super_admin`, `hr_admin`, `manager`, `employee`) and a non-empty permission catalog; the `INSERT`
fails with a Postgres permission-denied error, proving FR-002 at the database level, not just in
application code.

## 2. Verify RLS blocks cross-tenant access (SC-003, SC-004)

Using two seeded test tenants (`tenant_a`, `tenant_b`) with at least one role each:

```sql
BEGIN;
SET LOCAL app.tenant_id = '<tenant_a-uuid>';
-- Attempt to read tenant_b's role by its known id:
SELECT * FROM roles WHERE id = '<tenant_b-role-uuid>';
-- Expected: zero rows, even though the row exists and the id is correct.

-- Attempt to write into tenant_b's role from tenant_a's session:
UPDATE roles SET name = 'hijacked' WHERE id = '<tenant_b-role-uuid>';
-- Expected: zero rows affected (RLS WITH CHECK / USING silently excludes it), not an error.
COMMIT;
```

Then confirm the fail-closed case:

```sql
BEGIN;
-- Deliberately do NOT set app.tenant_id
SELECT * FROM roles;
-- Expected: either zero rows or an error (cast of unset/empty setting to uuid fails) —
-- never all tenants' rows.
COMMIT;
```

## 3. Verify permission enforcement through the Fastify layer

```bash
# Authenticate as a user whose role does NOT include `approve_enrollment`, then:
curl -i -X POST http://localhost:3001/enrollments/123/approve \
  -H "Authorization: Bearer <token-for-user-without-permission>"
# Expected: HTTP 403

# Repeat as a user whose role DOES include it:
curl -i -X POST http://localhost:3001/enrollments/123/approve \
  -H "Authorization: Bearer <token-for-user-with-permission>"
# Expected: HTTP 200 (or whatever the eventual enrollment-approval endpoint returns)

# Spoof a foreign tenant id in a header/body alongside a valid token:
curl -i -X POST http://localhost:3001/enrollments/123/approve \
  -H "Authorization: Bearer <token-for-user-in-tenant-a>" \
  -H "X-Tenant-Id: <tenant-b-uuid>"
# Expected: the server ignores the header and enforces tenant_a (the session's real tenant) —
# result must match what tenant_a's own permissions dictate, never tenant_b's.
```

Note: the enrollment-approval endpoint itself belongs to a different feature; the calls above assume
*any* endpoint wired with `fastify.requirePermission("approve_enrollment")` (research.md §3) for the
purpose of proving the enforcement pattern, not that this exact route exists yet.

## 4. Verify the Super Admin catalog view (demoable slice)

```bash
curl -i http://localhost:3001/admin/permissions -H "Authorization: Bearer <super-admin-token>"
curl -i http://localhost:3001/admin/role-templates -H "Authorization: Bearer <super-admin-token>"
# Expected: HTTP 200 with the shapes defined in contracts/super-admin-catalog-api.md

curl -i http://localhost:3001/admin/permissions -H "Authorization: Bearer <non-super-admin-token>"
# Expected: HTTP 403
```

## 5. Verify `seedDefaultRolesForTenant` in isolation

```bash
# Run as a script/test harness (no provisioning UI exists yet):
pnpm --filter api exec vitest run src/permissions/seed-default-roles.test.ts
```
**Expected**: a fresh test tenant ends up with 3 roles (`hr_admin`, `manager`, `employee` —
Super Admin excluded), each with the same permissions as its source template; calling the function a
second time for the same tenant fails on the `(tenant_id, name)` unique constraint rather than
duplicating rows.

## Validation Log

Run against the local `docker-compose.yml` Postgres 16 container (port remapped to 5433 to avoid a
local Postgres.app conflict — see `docker-compose.yml`), all migrations through
`0008_platform_reader_grants.sql` applied.

- **§1 (catalog seeded + read-only)**: PASS — `permissions`/`role_templates` return the expected
  5 permissions / 4 templates as `tm_app`; `INSERT` as `tm_app` fails with
  `permission denied for table permissions`.
- **§2 (RLS cross-tenant + fail-closed)**: PASS — proven by
  `tests/integration/rls-cross-tenant.test.ts` (automated, not just manually spot-checked): zero
  rows reading/updating another tenant's role, zero rows or a thrown error (never all tenants')
  when `app.tenant_id` is unset.
- **§3 (Fastify enforcement, incl. tenant/role-claim spoofing)**: PASS — proven by
  `tests/integration/enforcement-*.test.ts` against `POST /_internal/protected-demo` (the
  quickstart's hypothetical `/enrollments/123/approve` doesn't exist yet — this feature's demo
  route is the "any endpoint wired with `requirePermission`" the quickstart anticipates). No real
  auth exists yet, so these use `buildTestServer`'s `x-test-user-id`/`x-test-tenant-id` stub
  (`tests/helpers/test-server.ts`) in place of a real bearer token, per research.md §3's explicit
  assumption.
- **§4 (Super Admin catalog view)**: PASS — `GET /admin/permissions`/`GET /admin/role-templates`
  return `403` with no auth; manually verified `200` with real catalog/template data (including
  correct `permissions: string[]` per template) using a temporary auth-stub header, screenshotted
  in the browser at `apps/web/app/admin/permissions/page.tsx`, then reverted.
- **§5 (`seedDefaultRolesForTenant` in isolation)**: PASS — proven by
  `tests/integration/seed-default-roles.test.ts`.

Full suite at time of this log: `pnpm --filter api test` — 12 files, 19 tests, all passing.
