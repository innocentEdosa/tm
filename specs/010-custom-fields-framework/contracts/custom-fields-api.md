# Contract: Custom Fields Framework API

Generic, `formKey`-parameterized routes in a new `apps/api/src/custom-fields/tenant-form-routes.ts`
plugin. Every route requires `requireTenantUserSession()` first, then the stated permission (if any),
and operates through `request.tenantDb` (RLS-scoped — see data-model.md for the dual-visibility shape
on `form_fields`). Department's own routes (`tenant-department-routes.ts`) call
`saveCustomFieldValues()` directly (research.md §5), not through the `PUT` endpoint below.

## `GET /tenant/form-definitions`

**Permission**: `forms.manage.tenant` (this is the Settings > Forms list; per spec Assumptions, no
separate view-only permission exists for this feature).

**Response** `200`:
```json
{ "success": true, "data": [ { "id": "uuid", "key": "department", "name": "Department", "description": "string" } ] }
```

---

## `GET /tenant/form-fields?formKey=department`

**Permission**: none beyond `requireTenantUserSession()` — deliberately open to any authenticated
tenant user (research.md §4), since a form's own permission (e.g. `department.manage`) is what
actually gates reaching a screen that needs this data.

**Response** `200`: the merged, ordered field list (spec FR-006).
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fieldKey": "cost_center",
      "label": "Cost Center",
      "fieldType": "text",
      "options": null,
      "isRequired": false,
      "displayOrder": 10,
      "scope": "global" | "tenant"
    }
  ]
}
```
Global fields (`scope: "global"`) always sort ahead of tenant fields (`scope: "tenant"`) — see
data-model.md's "Merged field list" derived concept.

---

## `POST /tenant/form-fields`

**Permission**: `forms.manage.tenant`.

**Body**: `{ formKey: string; label: string; fieldKey?: string; fieldType: "text"|"textarea"|"number"|"date"|"select"|"multiselect"; options?: string[]; isRequired?: boolean }`.

**Behavior**:
1. Reject (`400`) if `label`/`fieldType` missing, or `options` missing/empty for a `select`/
   `multiselect` type.
2. If `fieldKey` omitted, derive it from `label` (research.md §6); if provided, use as-is.
3. Reject (`409`) if `fieldKey` collides with any existing field (global or this tenant's own,
   including archived ones) for this `formKey` (research.md §2).
4. Insert with `tenant_id` = caller's own tenant, `created_by = 'tenant_admin'`, `display_order` =
   one past this tenant's current highest tenant-owned `display_order` for this form (appends after
   the caller's own existing fields, never before a global field).

**Response** `201`: the created field, same shape as a `GET /tenant/form-fields` row (`scope:
"tenant"`).

---

## `PATCH /tenant/form-fields/:fieldId`

**Permission**: `forms.manage.tenant`.

**Body**: `{ label?: string; fieldType?: "..."; options?: string[]; isRequired?: boolean; displayOrder?: number; archived?: boolean }`.

**Behavior**:
1. `404` if `fieldId` doesn't resolve (RLS already makes a global or cross-tenant row simply
   unreachable for write purposes — resolves as "not found," not "forbidden," consistent with every
   other cross-tenant-reference check in this codebase).
2. `displayOrder`, if provided, re-sequences only among this tenant's own fields for this form — never
   accepted as a value that would place this field ahead of/interleaved with a global field (rejected
   `422` if it would).
3. `archived: true` sets `archived_at = now()` (research.md §7 — this is the only "removal" path; there
   is no hard-delete endpoint).

**Response** `200`: the updated field.

---

## `DELETE /tenant/form-fields/:fieldId`

Not implemented as a separate endpoint — archiving (`PATCH` with `{ archived: true }`) is the only
removal path (research.md §7), so there is nothing for a distinct `DELETE` to do that `PATCH` doesn't
already cover.

---

## `GET /tenant/custom-field-values?formKey=department&entityId=<uuid>`

**Permission**: none beyond `requireTenantUserSession()` (same reasoning as the field-definitions
read — the calling module's own entity permission already gated reaching this point).

**Response** `200`:
```json
{ "success": true, "data": { "cost_center": "Engineering", "headcount_target": 12 } }
```
Keyed by `fieldKey` for direct use as form state. RLS-scoped via `request.tenantDb` — a cross-tenant
`entityId` simply returns an empty object, never an error.

---

## `PUT /tenant/custom-field-values`

**Permission**: none beyond `requireTenantUserSession()` — framework completeness/testability
(research.md §5); Department's own routes call the underlying function directly instead of this
endpoint, for transactional atomicity with the department write itself.

**Body**: `{ formKey: string; entityId: string; values: Record<string, unknown> }`.

**Behavior**: Resolves the merged field list for `formKey`, validates each submitted value against its
field's `fieldType`/`isRequired` (spec FR-007), rejects (`422`, with per-field messages) on any
failure, else upserts one `custom_field_values` row per submitted field (unique on `(tenant_id,
entity_id, field_id)` — resave replaces, doesn't duplicate).

**Response** `200`: `{ "success": true }`, or `422` with per-field validation errors.

---

## Non-goals (explicitly out of scope for this contract)

- No endpoint creates, renames, or removes a `form_definitions` row (spec FR-001/FR-013) — that only
  ever happens via a migration.
- No Super Admin-facing endpoint for authoring global fields — the RLS/data model supports it
  (data-model.md), but building that route is the separate, future Super Admin Console "Form Defaults"
  spec (out of scope here).
- No conditional field logic, no validation beyond required/type, no CSV import mapping — all
  explicitly out of scope per the spec.
