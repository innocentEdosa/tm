# Data Model: Roles Management UI

This spec adds **no new tables and no new columns**. It reads and writes exclusively through the
existing `roles`, `role_permissions`, `user_roles`, and `permissions` tables (Roles & Permissions
Model, Spec 001). The only schema-adjacent change is a new **application-layer guard**, not a new
column (research.md §2).

## Existing tables this spec depends on (unchanged shape)

### `roles`

| Column | Type | Relevance to this spec |
|---|---|---|
| `id` | `uuid`, PK | |
| `tenant_id` | `uuid`, nullable | `NULL` reserved for the single platform Super Admin role (never shown in this tenant-facing screen). |
| `name` | `text`, not null | Unique per `(tenant_id, name)` — already enforced (existing `roles_tenant_id_name_unique` constraint), surfaced as a `409` on create/rename (FR-006/FR-014). |
| `description` | `text`, nullable | |
| `source_template_id` | `uuid`, nullable, FK → `role_templates.id` | **The signal this spec uses for "system role."** Non-null = derived from a platform role template at provisioning time = system role, read-only everywhere (FR-004/FR-005). Null = custom, created by this tenant, fully editable/deletable (subject to FR-012's member-count check). |
| `created_at` / `updated_at` | `timestamptz` | |

### `role_permissions` (join table)

| Column | Type |
|---|---|
| `role_id` | `uuid`, FK → `roles.id`, `ON DELETE CASCADE` |
| `permission_id` | `uuid`, FK → `permissions.id`, `ON DELETE CASCADE` |

Composite PK `(role_id, permission_id)`. Fully replaced (delete-then-reinsert) on every `PATCH` that
includes `permissionKeys` — existing behavior, unchanged by this spec.

### `user_roles` (assignment)

| Column | Type |
|---|---|
| `id` | `uuid`, PK |
| `tenant_id` | `uuid`, not null |
| `user_id` | `uuid`, not null |
| `role_id` | `uuid`, FK → `roles.id`, `ON DELETE RESTRICT` |

The `ON DELETE RESTRICT` FK is *already* what makes `DELETE /tenant/roles/:roleId` return a `409` when
members are assigned (existing behavior) — this spec's new `GET /tenant/roles` reads the same table via
`COUNT(*) GROUP BY role_id` to *show* that count proactively, rather than only discovering it when a
delete is attempted.

### `permissions`

| Column | Type | Relevance to this spec |
|---|---|---|
| `id` | `uuid`, PK | |
| `key` | `text`, unique | e.g. `manage_roles`, `department.view` — displayed as-is, not normalized (spec Assumptions). |
| `display_name` | `text`, not null | Shown as each checklist item's label. |
| `description` | `text`, not null | Shown as each checklist item's helper text. |
| `category` | `text`, not null | **The sole grouping field.** Drives the checklist's group headers — no hardcoded group list anywhere in this feature (FR-008/SC-005). |

## New application-layer concept: "system role" guard

Not a schema change — a check added to the existing `PATCH`/`DELETE /tenant/roles/:roleId` handlers
(research.md §2):

```
if (role.sourceTemplateId !== null) {
  return 403 "System roles cannot be modified."
}
```

Placed after the existing "does this role exist for this tenant" `404` check and before any write is
attempted, so a system role's id (which RLS *does* let the tenant see, since it belongs to their own
tenant) is correctly distinguished from an out-of-tenant id (`404`) versus an in-tenant-but-protected
id (`403`) — two different, correctly-distinguished failure reasons.

## Derived shapes (not stored — computed at request time)

### Role list row (`GET /tenant/roles`)

```
{
  id: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  isSystem: boolean;        // sourceTemplateId !== null
  memberCount: number;      // count(*) from user_roles WHERE role_id = this role's id
}
```

### Permission catalog entry (`GET /tenant/permission-catalog`)

```
{
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string;
}
```

Grouping by `category` into `{ category: string; permissions: PermissionCatalogEntry[] }[]` happens in
the frontend (a plain array `groupBy`), not server-side — consistent with `GET /admin/permissions`
already returning a flat list (research.md §4).

## Relationships (unchanged from Spec 001)

```
role_templates    1──* roles                (source_template_id, nullable — null = tenant-created)
roles             1──* role_permissions      (role_id)
permissions       1──* role_permissions      (permission_id)
roles             1──* user_roles            (role_id, ON DELETE RESTRICT — blocks deletion while assigned)
tenants           1──* roles                 (tenant_id, nullable — null reserved for the platform role)
```
