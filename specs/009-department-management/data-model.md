# Data Model: Department Management

All tables live in the shared Postgres schema (shared schema + RLS isolation model, per constitution
default, unchanged from Specs 001/002). This spec **alters two existing tables**
(`departments`, `users`) and **adds two rows** to the existing `permissions` catalog — it introduces
no brand-new table. `departments` and `users` become mutually referencing (research.md §9) — safe
under Drizzle's lazy `.references(() => ...)` pattern, already used elsewhere in this schema.

## Altered table: `departments` (existing, from Spec 002)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK | existing |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | existing |
| `name` | `text`, not null | existing; unique per `(tenant_id, name)` case-insensitively (existing constraint already matches spec FR-004 — confirm collation/expression index covers case-insensitivity, else add a `lower(name)` unique expression index in the same migration) |
| `source_template_id` | `uuid`, nullable, FK → `department_templates.id` | existing, unchanged |
| **`parent_department_id`** | `uuid`, nullable, FK → `departments.id` | **new**. Self-referencing. `NULL` = top-level department. |
| **`description`** | `text`, nullable | **new** |
| **`status`** | `text`, not null, default `'active'` | **new**. `CHECK (status IN ('active', 'archived'))`, mirroring `tenants.status`'s existing `CHECK` pattern. |
| **`manager_id`** | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | **new**. Any user in the tenant (research.md §9) — not restricted to members of this department. |
| **`assistant_manager_id`** | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | **new**. Same rules as `manager_id`; application layer rejects a write where this equals `manager_id` (both non-null). |
| `created_at` / `updated_at` | `timestamptz`, not null | existing, unchanged |

**Constraints (new, added by this spec)**:
- `parent_department_id` FK, `ON DELETE RESTRICT` (a department cannot be deleted while still
  referenced as another department's parent — implements FR-008's "no child departments" rule at the
  database level as a defense-in-depth backstop; the application layer checks and reports this
  explicitly *before* attempting the delete, so this constraint should never actually fire in normal
  operation).
- Existing `unique(tenant_id, name)` — confirmed still correct; case-insensitivity (FR-004) is
  enforced at the application layer (`lower()`-normalized comparison before insert/update) since a
  case-insensitive unique index would require an expression index (`unique index on
  (tenant_id, lower(name))`) — plan proposes adding this expression index in the same migration
  for defense-in-depth, replacing the plain unique constraint.
- No database-level depth-cap or cycle constraint — enforced in the application layer per
  research.md §3 (recursive ancestor-chain check inside the same transaction as every write).

**Isolation**: RLS already **enabled and forced** (`0010_rls_departments.sql`, unchanged). The new
`parent_department_id` self-reference needs no new RLS policy — every lookup of a parent (for the
picker, for the ancestor-chain check, for display) runs through `request.tenantDb`, so a cross-tenant
id is simply not found (research.md §4).

**Validation rules** (application layer, inside the write transaction):
- `name`: required, trimmed, unique per tenant case-insensitively.
- `parent_department_id`, if provided: must resolve (via `request.tenantDb`) to an existing department
  in the same tenant; must not equal the department's own id; must not be found in the department's own
  descendant set (no cycles); the resulting depth (ancestor chain length + 1) must be ≤ 3.
- `status`: `active` or `archived` only; defaults to `active` on create; editable on edit (spec
  UI — Create/Edit fields).
- `manager_id` / `assistant_manager_id`, if provided: each must resolve (via `request.tenantDb`) to an
  existing user in the same tenant (any user — spec FR-019, not restricted to this department's own
  members); if both are provided, they must not be equal (spec FR-020). Neither field is considered
  when evaluating the deletion-blocking rule (spec FR-021).

**State transitions**: `active ↔ archived`, freely reversible, independent per department (no cascade
to children — spec Assumptions). No other lifecycle states.

---

## Altered table: `users` (existing, from Spec 002/Tenant Auth Config)

| Column | Type | Notes |
|---|---|---|
| ...(all existing columns unchanged)... | | |
| **`department_id`** | `uuid`, nullable, FK → `departments.id` | **new**. A member's single "home" department (spec Key Entities — "Department Assignment"); `NULL` = unassigned. |

**Constraints (new)**: `department_id` FK, `ON DELETE RESTRICT` — a department cannot be deleted while
any `users` row still references it (implements FR-008's "no members assigned" rule at the database
level as a defense-in-depth backstop, mirroring the existing `user_roles.role_id` → `roles.id`
`ON DELETE RESTRICT` convention from Spec 001). The application layer checks and reports this
explicitly before attempting the delete, exactly as with the parent-department FK above.

**Isolation**: `users` already has RLS enabled and forced (`0011_rls_users.sql`, unchanged) — the new
column needs no policy change; it's just an additional nullable field on an already tenant-scoped row.

**Set by**: the existing `POST /tenant-auth/team` route gains one optional `departmentId` field
(research.md §2) — the department picker on that form only lists departments where
`status = 'active'` (spec FR-010 / User Story 4), scoped to the tenant via `request.tenantDb`.

---

## Extended catalog: `permissions` (existing, from Spec 001 — two new rows, no schema change)

| `key` | `display_name` | `category` |
|---|---|---|
| `department.view` | View departments | `department` |
| `department.manage` | Manage departments | `department` |

Seeded via a migration (mirroring `0014_seed_provision_tenant_permission.sql` /
`0022_seed_tenant_auth_permissions.sql`) — not auto-added to any existing role (Spec 001 FR-011); an
admin must explicitly add either key to a tenant role via the existing role-management UI/API.
`department.manage` is treated as inherently including `department.view` at the route-enforcement
level (any manage-gated route's read parts also accept a caller holding just `department.manage`), not
by one permission row implying another in the catalog itself.

**Isolation**: Same as every other `permissions` row — platform-global, no `tenant_id`, `SELECT`-only
grant to the application DB role (existing `0001_lock_catalog_grants.sql` pattern extended to cover
these two new rows automatically, since the grant is table-wide, not per-row).

---

## Relationships

```
tenants        1──* departments            (existing)
departments    1──* departments             (new: parent_department_id, self-referencing, ≤3 deep)
departments    1──* users                   (new: department_id, "home department")
users          0..1──* departments          (new: manager_id — a user may manage zero or more departments)
users          0..1──* departments          (new: assistant_manager_id — same, independent of manager_id)
department_templates 1──* departments       (existing: source_template_id, unchanged)
permissions    (2 new rows: department.view, department.manage — consumed by roles/role_permissions
                exactly like every existing permission, no schema change there)
```

## Derived concepts (not columns — computed at request time)

- **Direct member count** (spec FR-015, list view): `COUNT(*) FROM users WHERE department_id = :id
  AND tenant_id = :tenant` (RLS-scoped via `request.tenantDb`, no explicit tenant filter needed beyond
  what RLS already applies).
- **Subtree member count** (spec FR-016, deletion-block message): a `WITH RECURSIVE` query collects
  `:id` and every descendant department id, then counts `users` rows whose `department_id` is in that
  set (research.md §7).
- **Ancestor chain / depth** (cycle + depth-cap check, research.md §3): a `WITH RECURSIVE` query walking
  `parent_department_id` upward from a proposed parent, used to (a) reject the proposed parent if the
  department being saved appears in its own ancestor chain, and (b) reject if the chain length would
  place the department at a 4th level.
- **Has child departments** (spec FR-008, deletion-block reason): `EXISTS (SELECT 1 FROM departments
  WHERE parent_department_id = :id)`.
- **Tenant user search** (Manager/Assistant Manager pickers, spec FR-019, research.md §10):
  `SELECT id, full_name, email FROM users WHERE (full_name ILIKE :q OR email ILIKE :q)` (RLS-scoped via
  `request.tenantDb`) — not a stored concept, just the query backing `GET /tenant/users?search=`.
