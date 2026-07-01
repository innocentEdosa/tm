# Contract: `seedDefaultRolesForTenant` (internal function, not an HTTP endpoint)

Exposed for the future tenant-provisioning spec to call (spec FR-005). Lives in
`apps/api/src/permissions/` (module path proposed; finalized in tasks.md).

## Signature

```ts
function seedDefaultRolesForTenant(
  tenantDb: TenantScopedDb, // Drizzle instance bound to a transaction already running
                            // `SET LOCAL app.tenant_id = <tenantId>` — see research.md §3
  tenantId: string,         // UUID of the tenant being provisioned; MUST match the tenant_id
                            // already active on tenantDb's transaction
): Promise<{ rolesCreated: number }>
```

## Behavior

1. Reads every `role_templates` row where `is_platform_only = false` (i.e., all templates except
   Super Admin) and its associated `role_template_permissions`.
2. For each template, inserts one `roles` row scoped to `tenantId` (`name` and `description` copied
   from the template, `source_template_id` set to the template's id) and the matching
   `role_permissions` rows.
3. Returns the count of roles created, for the caller (provisioning flow) to log/verify.

## Non-goals (explicitly out of scope for this function)

- Does **not** create the tenant record itself, any department, or any user — those belong to the
  tenant-provisioning spec.
- Does **not** seed the Super Admin role — that row is platform-level and seeded exactly once via a
  schema migration, never per tenant.
- Does **not** decide *when* to run — the provisioning spec owns calling this at the right point in its
  own transaction.

## Preconditions the caller must guarantee

- Must be called inside a transaction where `SET LOCAL app.tenant_id` already equals `tenantId` —
  this function relies on RLS `WITH CHECK` policies on `roles`/`role_permissions` to scope its own
  inserts; it does not pass an explicit `tenant_id` filter itself, by design (research.md §4).
- Must be called at most once per tenant under normal operation; calling it twice will fail on the
  unique `(tenant_id, name)` constraint on `roles` rather than silently duplicating templates.
