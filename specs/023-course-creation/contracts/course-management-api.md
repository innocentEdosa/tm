# Contract: Course Management API

All routes live in a new `apps/api/src/courses/tenant-course-routes.ts` plugin (module path proposed;
finalized in tasks.md), registered in `server.ts` alongside the other tenant-scoped route plugins.
Every route requires `requireTenantUserSession()` first, then the stated permission, and operates
through `request.tenantDb` (RLS-scoped to the caller's own tenant — no route ever takes or trusts a
client-supplied tenant id).

## `GET /tenant/courses`

**Permission**: `course.view` (or `course.manage`, which implies it).

**Query params**:
- `search?: string` — matches `title`, case-insensitive substring.
- `category?: string` — category id.
- `deliveryMode?: "in_person" | "virtual" | "self_paced" | "blended"`
- `status?: "draft" | "active" | "archived"` — when omitted, archived courses are excluded by default
  (spec FR-002).
- `page?: number` (default `1`), `pageSize?: number` (default matches this codebase's existing
  `DEFAULT_PAGE_SIZE` convention, `training-needs` module) — research.md §7.

**Response** `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "description": "string | null",
      "category": { "id": "uuid", "name": "string" },
      "deliveryMode": "in_person" | "virtual" | "self_paced" | "blended",
      "duration": { "value": 2, "unit": "hours" },
      "provider": "string | null",
      "cost": "12.50 | null",
      "status": "draft" | "active" | "archived",
      "createdBy": { "id": "uuid", "fullName": "string" } | null,
      "createdAt": "ISO-8601",
      "updatedBy": { "id": "uuid", "fullName": "string" } | null,
      "updatedAt": "ISO-8601"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 42 }
}
```
Empty `data: []` for a tenant with zero matching courses (spec Edge Cases) — never an error, including
when `page` is requested past the last page.

**Errors**: `403` if the caller holds neither `course.view` nor `course.manage` (FR-008).

---

## `GET /tenant/courses/:courseId`

**Permission**: `course.view` (or `course.manage`).

**Response** `200`: single course, same shape as a list row.

**Errors**: `404` if `courseId` doesn't resolve in the caller's tenant — including when the id belongs
to a different tenant entirely (RLS makes it simply not found; never distinguished from "doesn't
exist," spec Edge Cases/FR-007). `403` if the caller holds neither permission.

---

## `GET /tenant/courses/categories`

**Permission**: `course.view` (or `course.manage`) — FR-001c.

**Response** `200`:
```json
{ "success": true, "data": [ { "id": "uuid", "name": "string" } ] }
```
Returns every category currently belonging to the tenant (the seeded six plus any created inline via
course create/update), ordered by `name`.

---

## `POST /tenant/courses`

**Permission**: `course.manage`.

**Body**:
```json
{
  "title": "string",
  "description": "string?",
  "category": "string",
  "deliveryMode": "in_person" | "virtual" | "self_paced" | "blended",
  "duration": { "value": "number > 0", "unit": "minutes" | "hours" | "days" },
  "provider": "string?",
  "cost": "number >= 0?"
}
```
`category` is a **name**, not an id — resolved-or-created inline (research.md §3/§4/FR-001b). `status`
is not accepted on create; it is always set to `draft` (FR-001).

**Behavior**:
1. Reject (`400`) if `title`, `category`, `deliveryMode`, or `duration` (or `duration.value`/
   `duration.unit`) is missing/blank.
2. Reject (`422`) if `deliveryMode` or `duration.unit` is not one of its fixed enum values, or if
   `duration.value <= 0`, or if `cost < 0` when provided (FR-010).
3. Resolve `category` per research.md §4 (case-insensitive match against the tenant's existing
   categories; auto-create if none matches).
4. Insert with `status = 'draft'`, `createdByUserId` = caller.

**Response** `201`: the created course, same shape as a list row.

**Errors**: `400`/`422` per above. `403` if the caller lacks `course.manage`.

---

## `PATCH /tenant/courses/:courseId`

**Permission**: `course.manage`.

**Body**: every field from `POST`'s body, all optional, plus `status?: "draft" | "active" |
"archived"`.

**Behavior**:
1. `404` if `courseId` doesn't resolve in the caller's tenant.
2. Same field-level validation as `POST` for any field present.
3. `status`, if present, is set directly to the requested value with no restricted transition graph
   (spec Clarifications/FR-005) — e.g. `archived → active` ("un-archiving") is accepted the same as any
   other transition.
4. `category`, if present, is resolved-or-created the same way as `POST` (a course's category can be
   changed to an existing or brand-new category name).
5. `updatedByUserId` = caller, `updatedAt` = now, on every successful write.

**Response** `200`: the updated course, same shape as a list row.

**Errors**: `400`/`422` per above. `403` if the caller lacks `course.manage`. `404` if not found.

---

## `POST /tenant/courses/:courseId/archive`

**Permission**: `course.manage`.

**Behavior**: Equivalent to `PATCH { status: "archived" }` (FR-006) — a convenience shorthand for the
common "retire this course" case, not the only way to reach `archived` (research.md — the general
`PATCH` also accepts `status: "archived"` directly). Archiving an already-archived course succeeds
idempotently (`200`, no error, no-op).

**Response** `200`: the archived course, same shape as a list row.

**Errors**: `403` if the caller lacks `course.manage`. `404` if `courseId` doesn't resolve in the
caller's tenant.

---

## Non-goals (explicitly out of scope for this contract)

- No `DELETE` endpoint for courses — archive (`status = 'archived'`) is the only removal mechanism
  (FR-011, spec Assumptions); a course row is never hard-deleted.
- No dedicated category write endpoint (`POST`/`PATCH`/`DELETE .../categories`) — categories are only
  ever created as a side effect of a course create/update, per research.md §3.
- No bulk/multi-select endpoint (matches spec 009's depth target, spec Input).
- No file/attachment upload (spec Input).
- No course content/curriculum endpoints (videos, articles, live classes) — deferred entirely to the
  follow-up Course Content spec (spec Clarifications/FR-012).
