# Contract: Learner Progress API

All routes live in a new `apps/api/src/progress/tenant-progress-routes.ts` plugin, registered in
`server.ts` alongside the other tenant-scoped route plugins. Every route requires
`requireTenantUserSession()` first, and operates through `request.tenantDb` (RLS-scoped to the caller's
own tenant — no route ever takes or trusts a client-supplied tenant id). Every route resolves its target
content item/course via `request.tenantDb` first — a cross-tenant or nonexistent id is rejected as `404`
before any progress logic runs. No route ever accepts a client-supplied `userId` — "self" is always
`request.user!.id` from the session.

## `PUT /tenant/content-items/:contentItemId/progress`

**Permission**: `course.view` (or `course.manage`) — the caller records/updates only their own row.

**Body**: `{ status: "not_started" | "in_progress" | "completed" | "failed"; scoreRaw?: number; scoreMin?: number; scoreMax?: number; bookmark?: string; suspendData?: string; sessionTimeSeconds?: number }`.

**Behavior**:
1. `404` if `contentItemId` doesn't resolve in the caller's tenant.
2. `400` if `status` missing or not one of the four fixed values.
3. `400` if `scoreRaw` is provided alongside both `scoreMin` and `scoreMax`, and falls outside
   `[scoreMin, scoreMax]` (research.md §6). Any other combination of score fields is valid, including
   omitting all three.
4. `400` if `suspendData` exceeds 4096 characters (FR-005, research.md §7).
5. Upserts the `(tenant, caller, contentItemId)` row (research.md §2): on first write, creates the row
   with `enteredAt: now`; on any later write, updates `status`/`scoreRaw`/`scoreMin`/`scoreMax`/
   `bookmark`/`suspendData` in place (replacing prior values wholesale), adds `sessionTimeSeconds`
   (default `0`) to the row's running `totalTimeSeconds`, and advances `exitedAt`/`updatedAt` to now.
   `status` is never validated against the row's previous value — any value is accepted on any update
   (spec Clarifications, Session 2026-07-19, Q1).

**Response** `200`: the resulting row (see shape under `GET .../progress` below).

**Errors**: `400`/`404` per above. `403` if the caller holds neither `course.view` nor `course.manage`
on the content item's course.

---

## `GET /tenant/content-items/:contentItemId/progress`

**Permission**: None beyond `requireTenantUserSession()` — self-access is gated by row ownership only,
not by `course.view`/`course.manage` (FR-010, research.md §4).

**Behavior**: `404` if `contentItemId` doesn't resolve in the caller's tenant. If no row exists yet for
`(caller, contentItemId)`, responds `200` with a synthetic "not started" result rather than `404` (spec
US2 AS2) — no row is created by a read.

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "contentItemId": "uuid",
    "status": "not_started",
    "scoreRaw": null,
    "scoreMin": null,
    "scoreMax": null,
    "bookmark": null,
    "suspendData": null,
    "totalTimeSeconds": 0,
    "enteredAt": null,
    "exitedAt": null,
    "updatedAt": null
  }
}
```
(`enteredAt`/`exitedAt`/`updatedAt` are non-null only once a real row exists.)

**Errors**: `404` if `contentItemId` doesn't resolve in the caller's tenant.

---

## `GET /tenant/courses/:courseId/progress`

**Permission**: None beyond `requireTenantUserSession()` — self-access only (FR-010).

**Behavior**: `404` if `courseId` doesn't resolve in the caller's tenant. Returns only the caller's own
progress rows for content items that have at least one, ordered by curriculum position (module position,
then content-item position within module — spec Clarifications, Session 2026-07-19, Q2, research.md §5).
Content items the caller has never touched are simply absent, not represented as placeholder rows.

**Response** `200`:
```json
{
  "success": true,
  "data": [
    {
      "contentItemId": "uuid",
      "status": "in_progress",
      "scoreRaw": null,
      "scoreMin": null,
      "scoreMax": null,
      "bookmark": "00:12:34",
      "suspendData": null,
      "totalTimeSeconds": 754,
      "enteredAt": "ISO-8601",
      "exitedAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```
Empty array for a course the caller has never touched (never an error).

**Errors**: `404` if `courseId` doesn't resolve in the caller's tenant.

---

## `GET /tenant/courses/:courseId/progress/learners`

**Permission**: `course.view` (or `course.manage`) — the manager/reporting review across every learner.

**Behavior**: `404` if `courseId` doesn't resolve in the caller's tenant. Returns every learner's
progress rows across the course's content items, identified by learner, ordered by curriculum position
then learner (research.md §5). Empty array for a course nobody has recorded progress on yet.

**Response** `200`:
```json
{
  "success": true,
  "data": [
    {
      "learner": { "id": "uuid", "fullName": "string" },
      "contentItemId": "uuid",
      "status": "completed",
      "scoreRaw": 88,
      "scoreMin": 0,
      "scoreMax": 100,
      "bookmark": null,
      "suspendData": null,
      "totalTimeSeconds": 1820,
      "enteredAt": "ISO-8601",
      "exitedAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

**Errors**: `404` if `courseId` doesn't resolve in the caller's tenant. `403` if the caller holds
neither `course.view` nor `course.manage`.

---

## Non-goals (explicitly out of scope for this contract)

- No delete/reset endpoint for a progress row — this spec defines no way to remove or restart progress
  (spec Assumptions; not listed as a Functional Requirement).
- No attempt-history endpoint — only the single current-state row per (learner, content item) exists
  (spec FR-015).
- No course/module-level completion-rollup or certificate endpoint (spec FR-016).
- No enrollment/assignment endpoint — access is governed solely by `course.view` at write time and row
  ownership thereafter (spec FR-014).
- No SCORM-specific RTE/API-object route — this contract exposes plain REST/JSON only; the SCORM Runtime
  spec builds its own JavaScript API object on top of these same routes/fields.
