# Contract: `seedDefaultDepartmentsForTenant` (internal function, not an HTTP endpoint)

Mirrors Spec 1's `seedDefaultRolesForTenant` contract shape (research.md §5). Lives in
`apps/api/src/provisioning/`. Called only by the `POST /provisioning/tenants` handler
(contracts/provision-tenant-api.md), never directly by a route.

## Signature

```ts
function seedDefaultDepartmentsForTenant(
  tenantDb: TenantScopedDb, // Drizzle instance bound to the provisioning transaction, already
                            // running `SET LOCAL app.tenant_id = <tenantId>` (research.md §1)
  tenantId: string,         // UUID of the tenant being provisioned; MUST match the tenant_id
                            // already active on tenantDb's transaction
): Promise<{ departmentsCreated: number }>
```

## Behavior

1. Reads every `department_templates` row (all of them — there is no platform-only carve-out here,
   unlike `role_templates`).
2. For each template, inserts one `departments` row scoped to `tenantId` (`name` copied from the
   template, `source_template_id` set to the template's id).
3. Returns the count of departments created.

## Non-goals

- Does **not** create the tenant record, any user, or any role — those belong to the calling
  provisioning function.
- Does **not** run at all when the caller's request supplied an explicit `departments` list — in that
  case the caller inserts the submitted list directly instead of calling this function
  (contracts/provision-tenant-api.md).

## Preconditions the caller must guarantee

- Must be called inside a transaction where `SET LOCAL app.tenant_id` already equals `tenantId` — this
  function relies on RLS `WITH CHECK` on `departments` to scope its own inserts, same as
  `seedDefaultRolesForTenant` relies on it for `roles` (research.md §1).
- Must be called at most once per tenant; calling it twice fails on the unique `(tenant_id, name)`
  constraint on `departments` rather than silently duplicating templates.
