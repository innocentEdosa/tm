# Quickstart: Validating the Extensible Custom Fields Framework

Prerequisites: `apps/api` and `apps/web` running (`pnpm dev` in each), local Postgres up
(`docker compose up postgres`), migrations applied, and a seeded tenant with an admin account holding
`department.manage` and `forms.manage.tenant` on their role (assign via the existing role-management
UI/API — these two permissions are seeded into the catalog but not auto-added to any role by default,
same convention as Spec 009's `department.view`/`department.manage`).

## 1. Confirm the schema, RLS policies, and seeded form type landed correctly

```bash
psql "$DATABASE_URL" -c "\d form_definitions"   # expect id, key, name, description, created_at
psql "$DATABASE_URL" -c "\d form_fields"         # expect tenant_id nullable, field_key, field_type,
                                                   # options, is_required, display_order, archived_at
psql "$DATABASE_URL" -c "\d custom_field_values"
psql "$DATABASE_URL" -c "SELECT key, name FROM form_definitions;"
# Expected: exactly one row — department
psql "$DATABASE_URL" -c "\d+ form_fields" | grep -i policy
# Expected: tenant_isolation, global_fields_readable, super_admin_full_access
```

## 2. Seed one example global field directly (Super Admin authoring UI doesn't exist yet)

Since the Super Admin authoring screen is explicitly out of scope for this spec (data-model support
only), create one global field by hand to validate the global/tenant split:

```sql
INSERT INTO form_fields (form_definition_id, tenant_id, field_key, label, field_type, is_required, display_order, created_by)
SELECT id, NULL, 'external_ref', 'External Reference', 'text', false, 0, 'super_admin'
FROM form_definitions WHERE key = 'department';
```

## 3. Tenant Admin extends the Department form (User Story 1, spec FR-002–FR-005)

1. Log in as the admin, open Settings > Forms, select "Department".
2. Confirm "External Reference" appears as a locked row with a "Global" indicator, no edit/delete
   affordance.
3. Add a field: label "Cost Center", type text, not required. Confirm it appears as an editable
   tenant row, auto-suggested key `cost_center`.
4. Attempt to add another field labeled "External Reference" (colliding with the global field's key)
   — expect rejection before saving (FR-005/SC-003), not just a same-tenant-only check.
5. Add a second tenant field ("Headcount Target," number, required) and drag-reorder the two tenant
   fields relative to each other — confirm neither can be dragged ahead of "External Reference."

## 4. Global fields stay locked (User Story 3, spec FR-004)

1. Attempt, via a direct API call as the `forms.manage.tenant` user, to `PATCH` the global "External
   Reference" field's `fieldId` — expect `404` (RLS makes it unreachable for write, not merely
   "forbidden" — data-model.md).
2. Confirm no UI path (no visible edit/delete/drag affordance) exists for it either.

## 5. Department's form renders and saves the merged fields (User Story 2, spec FR-006/FR-007/FR-015)

1. Open Department's Create drawer as a user holding only `department.manage` (not
   `forms.manage.tenant`) — confirm "External Reference," "Cost Center," and "Headcount Target" all
   render, in that order, after Department's own system fields (Name, Parent, Description, Status,
   Manager, Assistant Manager).
2. Submit without a value for the required "Headcount Target" — expect a field-level validation error,
   same as an empty required system field would produce.
3. Submit a complete department, including custom field values — confirm the department saves and the
   values are retrievable when reopening it for edit.

## 6. Archiving preserves historical values (User Story 4, spec FR-009)

1. Archive the tenant's "Cost Center" field (`PATCH .../form-fields/:id { "archived": true }` or via
   the UI).
2. Reopen the department edited in Step 5.3 for edit — confirm "Cost Center" no longer renders, but its
   previously saved value is still present in the database:
   ```sql
   psql "$DATABASE_URL" -c "SELECT value FROM custom_field_values cfv JOIN form_fields ff ON ff.id = cfv.field_id WHERE ff.field_key = 'cost_center';"
   ```
   Expected: the value from Step 5.3 is unchanged, not deleted.

## 7. Settings sidebar reorganization (User Story 5, spec FR-011/FR-012)

1. Confirm "Settings" appears as its own top-level sidebar section, distinct from "Administration,"
   containing "Authentication" and "Forms."
2. Visit the Authentication Settings page directly by its existing URL — confirm it still loads
   correctly (the route itself is unchanged; only its sidebar location moved — research.md/plan.md
   Summary).

## Verifying no functional regression

Re-run Spec 009's own quickstart scenarios for Department (view/create/edit/delete/archive) — confirm
every previously-working flow still works with the custom-fields section now present in the
create/edit drawer, and that a department with zero configured custom fields (any newly-provisioned
tenant that hasn't added any) still renders and saves exactly as it did before this feature shipped.
