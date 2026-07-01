# Data Model: Roles & Permissions Model

All tables live in the shared Postgres schema (shared schema + RLS isolation model, per constitution
default and [research.md](./research.md) §1–2). Each table below states its tenant-isolation
treatment explicitly, per the constitution's Quality Bar.

## Tables

### `permissions` — platform-global, no `tenant_id`

The catalog of discrete, checkable capabilities (spec FR-001, FR-002). Not tenant-scoped: a permission
only has meaning tied to actual server-side enforcement code, so it cannot vary per tenant.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `key` | `text`, unique, not null | Stable identifier, e.g. `approve_enrollment`. Never reused/renamed once shipped. |
| `display_name` | `text`, not null | |
| `description` | `text`, not null | |
| `category` | `text`, not null | e.g. `enrollment`, `content`, `analytics`. |
| `created_at` | `timestamptz`, not null, default `now()` | |

**Isolation**: RLS not applicable (no `tenant_id` column). Locked down at the Postgres grant level: the
application's runtime DB role has `SELECT` only; `INSERT`/`UPDATE`/`DELETE` are granted only to the
migration role that runs schema changes (FR-002 — no tenant or application code path can create,
rename, or delete a catalog permission).

**Validation rules**: `key` matches `^[a-z][a-z0-9_]*$` (enforced at the application layer generating
migrations, since new keys are only ever added via a code-shipped migration, never at runtime).

---

### `role_templates` — platform-global, no `tenant_id`

The default bundles (Super Admin, HR/L&D Admin, Manager, Employee/Learner) copied into a tenant at
provisioning time (spec FR-004, FR-005).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `key` | `text`, unique, not null | `super_admin`, `hr_admin`, `manager`, `employee` |
| `name` | `text`, not null | Display name shown to Super Admins reviewing templates. |
| `description` | `text`, not null | |
| `is_platform_only` | `boolean`, not null, default `false` | `true` only for the `super_admin` template — signals it is never copied into a tenant (see `roles` below). |
| `created_at` | `timestamptz`, not null, default `now()` | |

**Isolation**: Same as `permissions` — no RLS needed, `SELECT`-only grant to the application role.

---

### `role_template_permissions` — platform-global, no `tenant_id`

Join table: which permissions belong to each default template.

| Column | Type | Notes |
|---|---|---|
| `role_template_id` | `uuid`, FK → `role_templates.id`, part of composite PK | |
| `permission_id` | `uuid`, FK → `permissions.id`, part of composite PK | |

**Isolation**: Same as `permissions` — `SELECT`-only grant to the application role.

---

### `roles` — tenant-scoped, with one platform-level exception

A named, editable bundle of permissions (spec FR-003, FR-006, FR-007).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `tenant_id` | `uuid`, nullable, FK → tenants table (owned by a future tenant-provisioning spec) | `NULL` is reserved for exactly one row: the platform-level Super Admin role. Every tenant-owned role has a non-null `tenant_id`. |
| `name` | `text`, not null | Tenant-editable (FR-006); not unique platform-wide, unique per `tenant_id`. |
| `description` | `text` | Tenant-editable. |
| `source_template_id` | `uuid`, nullable, FK → `role_templates.id` | Tracks which default template this role originated from, if any; purely informational — editing a role never re-reads this. `NULL` for roles created fresh by a tenant admin. |
| `created_at` / `updated_at` | `timestamptz`, not null | |

**Constraints**:
- Partial unique index ensuring at most one row with `tenant_id IS NULL` (the Super Admin role).
- Unique `(tenant_id, name)` so a tenant cannot have two roles with the same name (tenant-editable
  `name`, but must stay unique within that tenant).

**Isolation**: RLS **enabled and forced**. Policy (conceptual, exact SQL generated via Drizzle
migration):
```
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
```
Because `tenant_id IS NULL` can never equal any tenant's UUID, this single policy also naturally
satisfies FR-007: no tenant session can ever see or modify the Super Admin row. A separate,
platform-only code path (outside this spec's scope — the future Super Admin console) uses a distinct
Postgres role/policy that bypasses this tenant filter for legitimate platform administration.

---

### `role_permissions` — tenant-scoped via its role

Join table: which permissions belong to each tenant-owned role (spec FR-006, FR-011).

| Column | Type | Notes |
|---|---|---|
| `role_id` | `uuid`, FK → `roles.id`, part of composite PK | |
| `permission_id` | `uuid`, FK → `permissions.id`, part of composite PK | |
| `created_at` | `timestamptz`, not null, default `now()` | |

**Isolation**: RLS **enabled and forced**, checked via the owning role:
```
USING (EXISTS (
  SELECT 1 FROM roles r
  WHERE r.id = role_permissions.role_id
    AND r.tenant_id = current_setting('app.tenant_id', true)::uuid
))
```
(mirrored in `WITH CHECK` for writes). This table is never auto-populated when a new `permissions` row
ships (FR-011) — rows are only inserted when an admin explicitly adds a permission to a role.

---

### `user_roles` — tenant-scoped

Assigns one or more roles to a user, within their own tenant (spec FR-008).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | |
| `tenant_id` | `uuid`, not null | Denormalized (not derived solely via `role_id` join) so RLS on this table doesn't require a subquery; validated against the assigned role's own `tenant_id` via a `CHECK`/trigger at write time so the two can never disagree. |
| `user_id` | `uuid`, not null | FK → users table (owned by a future auth/user-management spec; assumed to exist — see Assumptions in spec.md). |
| `role_id` | `uuid`, not null, FK → `roles.id` | |
| `created_at` | `timestamptz`, not null, default `now()` | |

**Constraints**: unique `(user_id, role_id)` — a user cannot be assigned the same role twice.
Deleting a `roles` row that still has `user_roles` referencing it is blocked at the FK level
(`ON DELETE RESTRICT`), implementing FR-012 without extra application logic.

**Isolation**: RLS **enabled and forced**:
```
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
```

## Relationships

```
role_templates 1──* role_template_permissions *──1 permissions
roles          1──* role_permissions          *──1 permissions
roles          1──* user_roles
roles          *──0..1 role_templates   (source_template_id, informational only)
```

## Derived concept: effective permissions

Not a table — computed at request time (spec FR-008, FR-009, FR-010):

> A user's effective permissions = the set union of all `permissions.key` reachable via every
> `roles` row the user holds through `user_roles`, joined through `role_permissions`. A user with zero
> `user_roles` rows has an empty effective-permission set (deny by default, FR-010).

This query runs *inside* the request's tenant-scoped transaction (research.md §3), so RLS already
restricts `roles`/`role_permissions`/`user_roles` to the caller's own tenant — the query itself never
needs an explicit `tenant_id = ...` filter, which is the point of relying on RLS rather than
application-level filtering.

## State transitions

None of these entities have a lifecycle/status field — `roles` are either present or deleted (blocked
while referenced, per FR-012), and `role_permissions`/`user_roles` rows are added or removed directly.
There is no draft/published or pending/approved state in this feature's scope.
