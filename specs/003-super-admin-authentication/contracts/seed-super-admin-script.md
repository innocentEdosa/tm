# Contract: `seed-super-admin.ts` (standalone script, not an HTTP endpoint)

Lives at `apps/api/scripts/seed-super-admin.ts`. Run manually by an operator (`pnpm --filter api
seed:super-admin`), never invoked by the running Fastify server (research.md §7 — `tm_app` has no
`INSERT` grant on `super_admins` at all, so this is a database-level guarantee, not just a convention).

## Invocation

```sh
# Non-interactive (e.g. scripted first deploy):
SUPER_ADMIN_EMAIL=operator@handiwoker.example SUPER_ADMIN_NAME='Jordan Lee' SUPER_ADMIN_PASSWORD='...' \
  pnpm --filter api seed:super-admin

# Interactive (local operator run):
pnpm --filter api seed:super-admin
# → prompts for email, name, and password via node:readline/promises (research.md §8)

# Adding an additional Super Admin when one already exists:
ALLOW_ADDITIONAL_SUPER_ADMIN=true SUPER_ADMIN_EMAIL=... SUPER_ADMIN_NAME=... SUPER_ADMIN_PASSWORD=... \
  pnpm --filter api seed:super-admin
```

## Behavior

1. Connects using `DATABASE_URL` (the migration/owner role) — never `APP_DATABASE_URL`.
2. Reads `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_NAME`/`SUPER_ADMIN_PASSWORD` from the environment; if any
   are missing, prompts for the missing ones interactively.
3. Runs `SELECT count(*) FROM super_admins`. If the count is `> 0` and
   `ALLOW_ADDITIONAL_SUPER_ADMIN` is not `"true"`, prints a message identifying how many Super Admin
   accounts already exist and exits `0` without inserting (FR-015 — safe to re-run, no duplicates).
4. Otherwise, hashes the password (the same `scrypt`-based helper the login route uses,
   `apps/api/src/platform-auth/password.ts`) and inserts one `super_admins` row.
5. Prints the created account's email (never the password or its hash) and exits `0`.

## Non-goals

- Does not create a session or log the new Super Admin in — that's a separate step via
  `POST /platform/login` (contracts/platform-auth-api.md).
- Does not validate password strength beyond a non-empty check — left to operator judgment for this
  milestone (data-model.md `super_admins` Validation rules).
- Does not support editing or deleting an existing Super Admin — full account management is out of
  scope for this spec.

## Preconditions

- Migrations through the one introducing `super_admins` must already be applied.
- `DATABASE_URL` must point at a role with `INSERT` privilege on `super_admins` (the migration/owner
  role already has this as table owner).
