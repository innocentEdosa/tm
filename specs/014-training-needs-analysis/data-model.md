# Data Model: Training Needs Analysis (TNA)

Shared Postgres schema + RLS isolation model (constitution default). This spec introduces **one new
table** (`training_needs`) and reuses the existing Custom Fields Framework tables (`form_definitions`,
`form_fields`, `custom_field_values`) unchanged — no columns are added to any Spec 010 table.

## Table: `training_needs`

A single training-need entry belonging to one department within one tenant (spec Key Entities).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid`, not null, FK → `tenants.id` | Standard tenant-scoping column, present on every tenant table. |
| `department_id` | `uuid`, not null, FK → `departments.id`, `ON DELETE RESTRICT` | Owning department; drives all visibility/delete scoping (research.md §2). Matches `users.department_id`'s existing `RESTRICT` convention — departments are archived (status change), never hard-deleted, so this reference always stays valid (spec Edge Cases). |
| `title` | `text`, not null | Training need / skill-gap description. Fixed system field (research.md §5). |
| `priority` | `text`, not null, `CHECK (priority IN ('low','medium','high'))` | Fixed system field (research.md §4). Reasonable default value set — see spec Assumptions. |
| `status` | `text`, not null, default `'draft'`, `CHECK (status IN ('draft','submitted'))` | Fixed system field. Drives Draft-privacy (research.md §2) and delete authorization (research.md §3). |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id`, `ON DELETE SET NULL` | The authoring Manager. Nullable-on-delete so a user's departure doesn't cascade-delete historical entries — matches `departments.manager_id`'s existing `SET NULL` convention. |
| `submitted_at` | `timestamptz`, nullable | Set once, when `status` transitions `draft` → `submitted`. Never cleared. Supports SC-002 ("visible immediately") auditability. |
| `created_at` / `updated_at` | `timestamptz`, not null, default `now()` | Standard. |

**Constraints**: No uniqueness constraint — a department accumulates many independent entries over
time (spec Assumptions: one entry = one discrete training need).

**Indexes**:
- `(tenant_id, department_id)` — department-scoped list queries (Manager's own view).
- `(tenant_id, status)` — org-wide Submitted-only list queries (`tna.view.all`).

**Isolation**: Standard single `tenant_isolation` RLS policy (`ENABLE`/`FORCE ROW LEVEL SECURITY`,
`USING`/`WITH CHECK` on `tenant_id = current_setting('app.tenant_id', true)::uuid`) — identical shape
to `departments` (research.md §1). No dual-visibility policy needed.

**State transitions**:

```text
(create) → draft ──submit (validates required fields)──> submitted
             │                                                │
             └── delete (Manager, own dept only) ──X          └── delete (tna.manage.all only)
```

Editing is permitted in both `draft` and `submitted` states (spec FR-006) and never changes `status` by
itself — only an explicit submit action does.

---

## Reused, unmodified: Custom Fields Framework tables (Spec 010)

### `form_definitions` — one new row

| `key` | `name` | `description` |
|---|---|---|
| `training_needs_analysis` | `Training Needs Analysis` | `Department-level training and skill-gap requests.` |

No schema change. Seeded via migration (`0047_seed_tna_form_definition.sql`), same shape as
`0030_seed_department_form_definition.sql`.

### `form_fields` — placeholder `is_system` rows + real tenant fields added later via Settings > Forms

Seeded via migration (`0048_seed_tna_system_fields.sql`, mirrors `0036`): four `is_system = true`,
`tenant_id = NULL`, `created_by = 'system'` rows for `title`, `priority`, `department_id`, `status`, so
they participate in the same `display_order` as tenant-added fields (research.md §5). No global
(`is_system = false`, `tenant_id = NULL`) fields are seeded — per the spec's Clarification session Q2,
everything beyond the four fixed fields is added **per-tenant**, by that tenant's own HR/L&D Admin,
through the existing Settings > Forms screen. A real tenant (e.g. the reference client) would add:
`function` (text), `type_of_gap` (multiselect: Process Gap / Tool-Technology Gap / People Gap),
`observable_incidences` (textarea), `steps_taken` (textarea), `performance_expectation` (textarea),
`affected_job_roles` (text), `recommended_training` (text) — illustrative, not seeded by this spec.

### `custom_field_values` — no schema change

Each tenant custom field's answer for a given `training_needs.id` is stored exactly as Department's
are: `(tenant_id, entity_id, field_id) → value jsonb`, `entity_id` pointing at `training_needs.id`
(no FK, per the framework's existing polymorphic-by-design shape).

---

## New permissions (seeded via migration, mirrors `0040_seed_team_view_permissions.sql`)

| Key | Display Name | Category | Default role template |
|---|---|---|---|
| `tna.view.all` | View All Training Needs | `learning` | `hr_admin` |
| `tna.view.department` | View Department Training Needs | `learning` | `manager` |
| `tna.manage.all` | Manage All Training Needs | `learning` | `hr_admin` |
| `tna.manage.department` | Manage Department Training Needs | `learning` | `manager` |

Seeded onto `role_template_permissions` (future tenant provisioning) and backfilled onto every
already-live tenant's `hr_admin`/`manager`-sourced `roles` via `role_permissions`, gated on
`NOT EXISTS` for idempotency — identical structure to `0040`.
