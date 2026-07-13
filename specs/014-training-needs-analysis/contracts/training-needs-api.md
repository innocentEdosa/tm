# Contract: Training Needs Analysis API

New `apps/api/src/training-needs/tenant-training-needs-routes.ts` plugin. Every route requires
`requireTenantUserSession()` first, then the stated permission, and operates through
`request.tenantDb` (RLS-scoped, tenant boundary only — see data-model.md and research.md §1–§3 for why
department/status visibility is enforced here in the handler, not via RLS). Custom field values for a
`training_needs` entry are read/written through the **existing, unmodified** Spec 010 endpoints below
with `formKey=training_needs_analysis` — no new custom-field endpoint is introduced by this feature.

## `GET /tenant/training-needs`

**Permission**: `requireAnyPermission("tna.view.all", "tna.view.department")`.

**Query params**: `department?: string (uuid)`, `priority?: "low"|"medium"|"high"`,
`page?: number`, `pageSize?: number` (org-wide view only, per research.md Scale/Scope).

**Behavior**:
1. Resolve `resolveTrainingNeedVisibilityScope(tenantDb, callerId, hasViewAll)` (research.md §2).
2. `kind: "all"` → return **Submitted-only** rows across every department, paginated, optionally
   filtered by `department`/`priority`.
3. `kind: "department"` → return Draft + Submitted rows within `departmentIds` (the caller's subtree),
   unpaginated.
4. `kind: "no_department_assigned"` → return an empty list.

**Response** `200`:
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "departmentId": "uuid", "departmentName": "string", "title": "string",
      "priority": "low" | "medium" | "high", "status": "draft" | "submitted",
      "createdByUserId": "uuid", "submittedAt": "string | null", "createdAt": "string", "updatedAt": "string" }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 0 }
}
```
`pagination` is present only for the `kind: "all"` (org-wide) response shape.

---

## `POST /tenant/training-needs`

**Permission**: `requireAnyPermission("tna.manage.all", "tna.manage.department")`.

**Body**: `{ departmentId?: string; title: string; priority: "low"|"medium"|"high"; status?: "draft"|"submitted" }`.

**Behavior**:
1. If the caller holds only `tna.manage.department`, `departmentId` (if supplied) MUST equal their own
   department (or be omitted, in which case it is auto-set) — reject `403` on mismatch. A
   `tna.manage.all` caller may target any department in the tenant.
2. `status` defaults to `"draft"` if omitted.
3. If `status: "submitted"` is passed at creation, required system and custom fields (per
   `form_fields.is_required`) are validated before insert (`400` on missing required field), and
   `submitted_at` is set to `now()`.
4. Insert with `tenant_id = request.user!.tenantId`, `created_by_user_id = request.user!.id`.

**Response** `201`: the created row, same shape as the list item above.

---

## `GET /tenant/training-needs/:id`

**Permission**: `requireAnyPermission("tna.view.all", "tna.view.department")`.

**Behavior**: Resolve visibility scope as in the list endpoint; if the row is outside the caller's
scope (wrong department subtree, or a Draft row and the caller only holds `tna.view.all`), return
`404` rather than `403` (research.md §9).

**Response** `200`: the row plus its resolved custom field values (fetched by the client separately via
`GET /tenant/custom-field-values?formKey=training_needs_analysis&entityId=:id`, per the existing
framework contract — not embedded here, matching Department's own client-side pattern).

---

## `PATCH /tenant/training-needs/:id`

**Permission**: `requireAnyPermission("tna.manage.all", "tna.manage.department")`.

**Body**: `{ title?: string; priority?: "low"|"medium"|"high"; status?: "submitted" }` (`departmentId`
is never editable after creation).

**Behavior**:
1. `tna.manage.department`-only caller: row's `department_id` must be within their subtree, else `404`
   (spec FR-008).
2. Field edits (title/priority) are allowed regardless of current `status` (spec FR-006) — no
   re-approval, no status reset.
3. `status: "submitted"` is only a legal transition from `"draft"`; validates required system and
   custom fields the same way `POST` does; sets `submitted_at = now()`. Submitting an
   already-`"submitted"` row is a no-op `200`, not an error.
4. Custom field value edits go through the existing `PUT /tenant/custom-field-values` endpoint, called
   separately by the client (same pattern Department's edit drawer already uses) — not part of this
   `PATCH` body.

**Response** `200`: the updated row.

---

## `DELETE /tenant/training-needs/:id`

**Permission**: `requireAnyPermission("tna.manage.all", "tna.manage.department")`.

**Behavior** (research.md §3):
- `tna.manage.all` holder: deletes any row, any status, any department.
- `tna.manage.department`-only holder: deletes only if `status = 'draft'` **and** the row's
  `department_id` is within their subtree. A Submitted row → `403`. Out-of-subtree row → `404`.

**Response** `204` on success.
