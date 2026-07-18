# Contract: Course Content API

All routes live in a new `apps/api/src/course-content/tenant-course-content-routes.ts` plugin (module
path proposed; finalized in tasks.md), registered in `server.ts` alongside the other tenant-scoped
route plugins. Every route requires `requireTenantUserSession()` first, then the stated permission
(reused from spec 023 — no new permission keys), and operates through `request.tenantDb` (RLS-scoped
to the caller's own tenant — no route ever takes or trusts a client-supplied tenant id).

## `GET /tenant/courses/:courseId/curriculum`

**Permission**: `course.view` (or `course.manage`).

**Response** `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Module 1: Introduction",
      "description": "string | null",
      "contentItems": [
        {
          "id": "uuid",
          "type": "video",
          "title": "string",
          "description": "string | null",
          "payload": { "url": "https://..." },
          "createdBy": { "id": "uuid", "fullName": "string" } | null,
          "createdAt": "ISO-8601",
          "updatedBy": { "id": "uuid", "fullName": "string" } | null,
          "updatedAt": "ISO-8601"
        }
      ],
      "createdBy": { "id": "uuid", "fullName": "string" } | null,
      "createdAt": "ISO-8601",
      "updatedBy": { "id": "uuid", "fullName": "string" } | null,
      "updatedAt": "ISO-8601"
    }
  ]
}
```
Modules in `position` order; each module's `contentItems` in their own `position` order. Empty array
for a course with zero modules (spec Edge Cases) — never an error.

**Errors**: `404` if `courseId` doesn't resolve in the caller's tenant. `403` if the caller holds
neither permission.

---

## `POST /tenant/courses/:courseId/modules`

**Permission**: `course.manage`.

**Body**: `{ title: string; description?: string }`.

**Behavior**: `400` if `title` missing/blank. `404` if `courseId` doesn't resolve in the caller's
tenant. Inserted with `position = count(*)` of the course's existing modules (append-last — spec
Clarifications; no `position` field is accepted in the body, and one present is ignored) and
`createdByUserId` set to the caller (FR-012).

**Response** `201`: the created module, same shape as a curriculum-response module row, with
`contentItems: []`.

---

## `PATCH /tenant/modules/:moduleId`

**Permission**: `course.manage`.

**Body**: `{ title?: string; description?: string | null }`.

**Behavior**: `404` if `moduleId` doesn't resolve in the caller's tenant. `400` if `title` is present
but blank. No `position`/`courseId` field is accepted (a module cannot be moved to a different course
in this spec, and position changes only via the reorder endpoint below).

**Response** `200`: the updated module (without `contentItems` — this endpoint doesn't re-fetch them).

---

## `DELETE /tenant/modules/:moduleId`

**Permission**: `course.manage`.

**Behavior**: `404` if `moduleId` doesn't resolve in the caller's tenant. Deletes the module; every
content item it held is removed via `ON DELETE CASCADE` (spec FR-009, data-model.md).

**Response** `200`: `{ "success": true }`.

---

## `POST /tenant/courses/:courseId/modules/reorder`

**Permission**: `course.manage`.

**Body**: `{ moduleIds: string[] }` — the complete ordered list of the course's module ids in the
desired sequence.

**Behavior**: `404` if `courseId` doesn't resolve in the caller's tenant. `422` if the submitted id set
does not *exactly* match the course's current module id set (missing an id, includes a foreign/unknown
id, or a duplicate — spec FR-007/Edge Cases). On success, rewrites every module's `position` to its
index in the submitted list, in one transaction.

**Response** `200`: `{ "success": true, "data": [ /* modules, in new order, same shape as GET curriculum's module rows without contentItems */ ] }`.

---

## `POST /tenant/modules/:moduleId/content-items`

**Permission**: `course.manage`.

**Body**:
```json
{
  "type": "video" | "article" | "live_class" | "test" | "assignment" | "external_import",
  "title": "string",
  "description": "string?",
  "payload": { }
}
```
`payload`'s required shape depends on `type` (data-model.md table):
- `video`: `{ url: string }`
- `article`: `{ body?: string; externalUrl?: string }` — at least one of the two required
- `live_class`: `{ scheduledAt: string; facilitator?: string; meetingLink?: string; capacity?: number }`
- `test`: `{ passCriteria?: string }`
- `assignment`: `{}` (no fields)
- `external_import`: `{ url: string; sourceType: string }`

**Behavior**: `400` if `type` or `title` missing/blank. `404` if `moduleId` doesn't resolve in the
caller's tenant. `422` if `type` isn't one of the six values, or `payload` doesn't satisfy the
required-field set for the given `type` (spec FR-004/FR-005). `courseId` is set from the resolved
module, not accepted in the body. Inserted with `position = count(*)` of the module's existing content
items (append-last; no `position` field accepted) and `createdByUserId` set to the caller (FR-012).

**Response** `201`: the created content item, same shape as a curriculum response's content-item row.

---

## `PATCH /tenant/content-items/:contentItemId`

**Permission**: `course.manage`.

**Body**: `{ title?: string; description?: string | null; payload?: object; moduleId?: string }`.
`type` is **not** an accepted field — immutable once created (spec Assumptions; a request including it
is rejected).

**Behavior**:
1. `404` if `contentItemId` doesn't resolve in the caller's tenant.
2. `400`/`422` for a `type` field present in the body (immutability violation), blank `title`, or a
   `payload` that fails the item's existing `type`'s required-field validation.
3. If `moduleId` is present (a move — spec FR-008): resolve the target module via
   `request.tenantDb` (`404` if not found in tenant); reject (`422`, "cannot move a content item to a
   module in a different course") if its `courseId` doesn't match the content item's own `courseId`
   (data-model.md, research.md §6). On success, `position` resets to append-last in the target module —
   no `position` field is separately accepted to control this.
4. Every other present field updates normally; `updatedByUserId`/`updatedAt` refresh on every
   successful write.

**Response** `200`: the updated content item.

---

## `DELETE /tenant/content-items/:contentItemId`

**Permission**: `course.manage`.

**Behavior**: `404` if `contentItemId` doesn't resolve in the caller's tenant. Deletes the row (never
cascades to anything — content items have no children in this spec).

**Response** `200`: `{ "success": true }`.

---

## `POST /tenant/modules/:moduleId/content-items/reorder`

**Permission**: `course.manage`.

**Body**: `{ contentItemIds: string[] }` — the complete ordered list of the module's content-item ids in
the desired sequence.

**Behavior**: `404` if `moduleId` doesn't resolve in the caller's tenant. `422` if the submitted id set
does not exactly match the module's current content-item id set. On success, rewrites every item's
`position` to its index in the submitted list, in one transaction.

**Response** `200`: `{ "success": true, "data": [ /* content items, in new order */ ] }`.

---

## Non-goals (explicitly out of scope for this contract)

- No native file upload for any content type — `video`/`article`/`external_import` are external
  URL/embed or inline-text only (spec FR-013, deferred future work).
- No SCORM/xAPI manifest parsing, hosting, or runtime playback/completion API — `external_import` is a
  metadata pointer only (spec FR-014, deferred future work).
- No question-authoring, submission, grading, or attempt-tracking endpoints for `test`/`assignment`
  (spec FR-015, deferred future work).
- No learner-facing progress/completion/score endpoints anywhere in this contract — authoring only
  (spec FR-016, deferred future work).
- No endpoint accepts an explicit target position on create or move — append-only; the two `reorder`
  endpoints are the only way to place anything but last (spec Clarifications).
- No cross-course move for content items or modules — a module always stays on the course it was
  created on; a content item may only move between modules of its *own* course.
