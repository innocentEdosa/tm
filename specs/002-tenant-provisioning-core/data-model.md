# Data Model: Tenant Provisioning Core

All new tables live in the same shared Postgres schema as Spec 1's tables (shared schema + RLS
isolation model — no change to that model, per constitution Quality Bar and
[research.md](./research.md) §1). Each table states its tenant-isolation treatment explicitly.

## Tables

### `tenants` — the platform root record for a tenant

The tenant itself (spec FR-001–FR-004). Its own `id` *is* the `tenant_id` every other tenant-scoped
table in the system (this spec's and Spec 1's) is keyed by.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` generated in application code (research.md §1) | This is the platform-wide `tenant_id`. |
| `name` | `text`, not null | Company name (FR-001). |
| `subdomain` | `text`, unique, not null | Globally unique across the platform (spec Assumptions); enforced at the DB level, checked via unique-violation (research.md §2), not a pre-read. |
| `industry` | `text`, nullable | FR-001; optional identifying field. |
| `primary_contact_name` | `text`, not null | Stored as plain fields on `tenants` itself, confirmed via Clarifications — not a separate entity, not tied to the admin user. |
| `primary_contact_email` | `text`, not null | |
| `primary_contact_phone` | `text`, nullable | |
| `status` | `text`, not null, default `'trial'` | `CHECK (status IN ('trial','active','suspended','cancelled'))`. Every insert path in this spec sets it via the column default only — no code path in this spec sets any value other than `'trial'` (FR-004). Text + `CHECK`, not a Postgres `ENUM`, matching this codebase's existing convention (no enum types used anywhere in Spec 1's schema). |
| `created_at` / `updated_at` | `timestamptz`, not null, default `now()` | |

**Isolation**: RLS **enabled and forced**:
```
USING (id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (id = current_setting('app.tenant_id', true)::uuid)
```
Same idiom as every tenant-scoped table in Spec 1. `app.tenant_id` is set to the newly generated `id`
*before* this row is inserted (research.md §1), so the `WITH CHECK` passes for the one row being
created. This intentionally means the `tm_app` connection can never enumerate other tenants — a future
platform-wide "list all tenants" admin console is out of scope here and will need its own narrow
`BYPASSRLS` read path, exactly like `tm_platform_reader` (research.md §7 precedent), not a change to
this policy.

**Non-goals**: no plan-tier, feature-flag, or usage-limit column (spec FR-012) — Spec 5 attaches that
data to this same row later without altering any column defined here.

---

### `department_templates` — platform-global, no `tenant_id`

The default department catalog applied to every new tenant (spec FR-006), mirroring
`role_templates`'s shape minus a permissions join table.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `key` | `text`, unique, not null | `hr`, `sales`, `engineering`, `finance`, `operations`, `customer_support` (research.md §5). |
| `name` | `text`, not null | Display name copied onto each tenant's `departments` row at seed time. |
| `created_at` | `timestamptz`, not null, default `now()` | |

**Isolation**: Same as `role_templates` — no RLS needed (no `tenant_id`), `SELECT`-only grant to the
`tm_app` role; only a migration can add/rename/remove a template.

---

### `departments` — tenant-scoped

A tenant-owned unit of org structure (spec FR-006, FR-007).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `name` | `text`, not null | Tenant-editable (FR-007). |
| `source_template_id` | `uuid`, nullable, FK → `department_templates.id`, `ON DELETE SET NULL` | Informational only, mirrors `roles.source_template_id`; `NULL` for admin-added departments. |
| `created_at` / `updated_at` | `timestamptz`, not null, default `now()` | |

**Constraints**: unique `(tenant_id, name)` — mirrors `roles`' `(tenant_id, name)` constraint;
duplicate names within one tenant's submitted `departments` list surface as a `23505`, rolling back
the whole provisioning transaction (FR-013).

**Isolation**: RLS **enabled and forced**, identical shape to `roles`:
```
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
```

---

### `users` — tenant-scoped, auth-free

The initial admin's account (spec FR-008, FR-009). Deliberately minimal — no password hash, no SSO
linkage; Spec 3 extends this same table rather than replacing it (research.md §6).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | |
| `full_name` | `text`, not null | FR-008. |
| `email` | `text`, not null | Not globally unique — the same email may belong to users in different tenants (spec Edge Cases). Unique only within a tenant. |
| `created_at` / `updated_at` | `timestamptz`, not null, default `now()` | |

**Constraints**: unique `(tenant_id, email)`.

**Isolation**: RLS **enabled and forced**, identical shape to `roles`/`departments`.

---

### `user_roles` (Spec 1) — no schema change; FK deliberately NOT added

A FK from `user_roles.user_id` to this spec's `users.id` was planned and then reverted during
implementation: `users.tenant_id` is `NOT NULL`, but Spec 1's platform-level Super Admin role
assignment (`roles.tenant_id IS NULL`) has no tenant to attach a `users` row to. No spec has yet
defined how a platform operator/internal staff member is represented as a row in this tenant-scoped
`users` table — adding the FK would have made Super Admin role assignment impossible to satisfy.
`user_roles.user_id` remains a bare `uuid` with no FK, unchanged from Spec 1. This spec's own
`provisionTenant` still inserts a real `users` row before the corresponding `user_roles` row, so
referential correctness holds for tenant admins through application logic even without a DB-level FK.
Left as an explicit open item for whichever future spec (Spec 3, or a platform-operator identity
spec) resolves how platform staff are represented.

## Relationships

```
tenants               1──* departments        (tenant_id)
tenants               1──* users               (tenant_id)
tenants               1──* roles               (tenant_id — Spec 1 table, no schema change)
department_templates  1──* departments         (source_template_id, informational only)
role_templates        1──* roles               (source_template_id — Spec 1, unchanged)
users                 0──* user_roles          (user_id — no DB-level FK; see `user_roles` above)
roles                 1──* user_roles          (role_id — Spec 1, unchanged)
```

## State transitions

`tenants.status`: only `trial` is reachable through any write path defined in this spec (FR-004). The
column's `CHECK` constraint already allows `active`/`suspended`/`cancelled` so a future lifecycle spec
can add transition logic without an `ALTER TABLE`, but no code in this spec ever writes those values.

`departments`, `users`: no lifecycle/status field — rows are created at provisioning time and edited
directly (no draft/published or pending/approved state in this feature's scope, matching Spec 1's
`roles` precedent).

## Derived concept: a provisioning attempt

Not a table — a single transaction (research.md §1, §3): generate `tenantId` → `SET LOCAL
app.tenant_id` → insert `tenants` → seed/insert `departments` → insert `users` (admin) → call
`seedDefaultRolesForTenant` (Spec 1, unchanged) → look up the tenant's `hr_admin`-sourced role →
insert `user_roles`. Any failure at any step rolls back the entire transaction, leaving zero rows from
that attempt (FR-013) — there is no persisted "in-progress" or "partial" state to model.
