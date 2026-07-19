# Contract: SCORM Runtime API

Two new Fastify plugins: `apps/api/src/scorm/tenant-scorm-upload-routes.ts` (admin upload/import,
`course.manage`) and `apps/api/src/scorm/tenant-scorm-runtime-routes.ts` (learner launch/runtime,
`course.view`). Every route requires `requireTenantUserSession()` first, then the stated permission, and
operates through `request.tenantDb` (RLS-scoped) — no route ever takes or trusts a client-supplied
tenant id. Every route resolves its target content item/package via `request.tenantDb` first — a
cross-tenant or nonexistent id is rejected as `404` before any SCORM-specific logic runs.

## `POST /tenant/content-items/:contentItemId/scorm/upload-url`

**Permission**: `course.manage`.

**Body**: `{ sizeBytes: number }`.

**Behavior**:
1. `404` if `contentItemId` doesn't resolve in the caller's tenant, or isn't `type: "external_import"`
   with `payload.sourceType: "scorm"`.
2. `422` if `sizeBytes` is missing, `<= 0`, or exceeds the 500MB cap (research.md §11).
3. `409` if any `scorm_package_items` row already exists for this content item (a package has already
   been imported — re-upload is only allowed before first import; re-versioning after first *launch* is
   separately blocked at import time, FR-015).
4. Returns a presigned `PutObject` URL (15-minute expiry, mirrors spec 025) scoped to a raw-upload
   storage key `{tenantId}/scorm-raw/{contentItemId}/{uploadId}.zip`.

**Response** `201`: `{ "success": true, "data": { "uploadUrl": "https://...", "storageKey": "..." } }`.

**Errors**: `404`/`409`/`422` per above. `403` if the caller lacks `course.manage`.

---

## `POST /tenant/content-items/:contentItemId/scorm/import`

**Permission**: `course.manage`.

**Body**: `{ storageKey: string }` (from the upload-url response).

**Behavior**:
1. `404` if `contentItemId` doesn't resolve in the caller's tenant.
2. `409` if `storageKey`'s object doesn't exist in R2, or if a package already exists for this content
   item and any learner has already launched one of its SCOs (FR-015).
3. Downloads the raw zip, extracts with `adm-zip`; `422` if the archive is invalid or lacks
   `imsmanifest.xml` at its root (spec US1 AS3).
4. Parses the manifest with `fast-xml-parser`; `422` if any `<item>`'s `<resource>` fails to resolve to
   a real file in the archive (spec US1 AS4) — nothing is created or modified on this path.
5. On success: creates one `scorm_packages` row; creates/reuses one content item per SCO (the
   uploaded-to content item becomes the first SCO; additional content items are created, positioned
   immediately after it in the module — FR-003); creates one `scorm_package_items` row per SCO; uploads
   every extracted file to R2 under `{tenantId}/scorm/{packageId}/{relativePath}` via the new
   `storage.putObject`; deletes the raw uploaded zip.

**Response** `201`:
```json
{
  "success": true,
  "data": {
    "packageId": "uuid",
    "scos": [
      { "contentItemId": "uuid", "title": "string", "position": 0 }
    ]
  }
}
```

**Errors**: `404`/`409`/`422` per above. `403` if the caller lacks `course.manage`.

---

## `GET /tenant/content-items/:contentItemId/scorm/launch`

**Permission**: `course.view` (or `course.manage`).

**Behavior**: `404` if `contentItemId` doesn't resolve in the caller's tenant, or has no
`scorm_package_items` row (nothing imported yet). Returns everything the launcher page's client JS needs
to seed the RTE API object's in-memory CMI model and render navigation, in one call.

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "packageId": "uuid",
    "entryPointUrl": "/tenant-api/tenant/scorm/packages/{packageId}/files/{entryPointRelativePath}",
    "cmi": {
      "lessonStatus": "not attempted",
      "scoreRaw": null, "scoreMin": null, "scoreMax": null,
      "bookmark": null, "suspendData": null, "totalTimeSeconds": 0,
      "entry": "ab-initio",
      "objectives": [],
      "interactions": []
    },
    "studentId": "uuid", "studentName": "string",
    "navigation": {
      "position": 0,
      "packageStatus": "in_progress",
      "scos": [
        { "contentItemId": "uuid", "title": "string", "position": 0, "status": "not_started" }
      ]
    }
  }
}
```
`cmi.lessonStatus` is the **exact, raw** SCORM value (`passed`/`completed`/`failed`/`incomplete`/
`browsed`/`not attempted`) — stored losslessly in `learner_content_progress.scormRawLessonStatus`
(schema addition, distinct from that table's own 4-value `status` column). `navigation.scos[].status`
and `navigation.packageStatus`, by contrast, use the *mapped* 4-value vocabulary
(`mapLessonStatusToProgressStatus`) since they're derived from/feed into spec 026's own cross-cutting
rollup logic, which only knows that vocabulary. `cmi.entry` is `"resume"` instead of `"ab-initio"`
whenever a `learner_content_progress` row already exists for this (caller, content item) pair (spec
FR-011). `navigation.packageStatus` is `"completed"` only when every sibling SCO's own mapped status is
`"completed"`, otherwise `"in_progress"` if any SCO has been touched, else `"not_started"` (spec FR-014,
"all SCOs must complete" — computed fresh on every launch-data request, not cached).

**Errors**: `404` per above. `403` if the caller holds neither `course.view` nor `course.manage`.

---

## `PUT /tenant/content-items/:contentItemId/scorm/cmi`

**Permission**: `course.view` (or `course.manage`) — the caller commits only their own CMI state (no
`userId` is ever accepted from the client, mirrors spec 026's own self-only write convention).

**Body**:
```json
{
  "lessonStatus": "passed",
  "scoreRaw": 88, "scoreMin": 0, "scoreMax": 100,
  "bookmark": "page-3",
  "suspendData": "...",
  "sessionTimeSeconds": 342,
  "objectives": [ { "objectiveId": "obj-1", "status": "passed", "scoreRaw": 90 } ],
  "interactions": [ { "interactionId": "q1", "type": "choice", "studentResponse": "b", "result": "correct" } ]
}
```
`lessonStatus` must be one of the six raw SCORM values (`SCORM_LESSON_STATUSES`).

**Behavior**:
1. `404` if `contentItemId` doesn't resolve in the caller's tenant, or has no `scorm_package_items` row.
2. `400` if `lessonStatus` is missing/not one of the six values, or `suspendData` exceeds 4096 characters
   (reuses spec 026's own `progress-validation.ts` rule for the latter).
3. In one transaction: upserts the `learner_content_progress` row for (caller, content item) — `status`
   set via `mapLessonStatusToProgressStatus(lessonStatus)`, `scormRawLessonStatus` set to the exact
   submitted value, plus score/bookmark/suspendData/accumulated totalTimeSeconds exactly per spec 026's
   own upsert logic; replaces the caller's `scorm_cmi_objectives`/`scorm_cmi_interactions` rows for this
   content item with the submitted arrays (delete-then-insert, research.md's Derived Concepts).

**Response** `200`: `{ "success": true }` — the RTE API's `LMSCommit`/`LMSFinish` translate this to
SCORM's `"true"` string; a non-`200` response translates to `"false"` plus the corresponding SCORM error
code (see Error Codes below).

**Errors**: `400`/`404` per above. `403` if the caller holds neither `course.view` nor `course.manage`.

---

## `GET /tenant/scorm/packages/:packageId/files/*`

**Permission**: `course.view` (or `course.manage`).

**Behavior**: `404` if `packageId` doesn't resolve in the caller's tenant, or the requested relative path
doesn't exist in R2 under the computed key. Streams the file's bytes directly (research.md §7), setting
`Content-Type` from a file-extension lookup table.

**Response**: `200`, raw file bytes, streamed.

**Errors**: `404` per above. `403` if the caller holds neither `course.view` nor `course.manage`.

---

## SCORM 1.2 RTE error codes (FR-009)

Implemented entirely client-side, inside the `window.API` object (`apps/web/lib/scorm-rte-api.ts`) — the
codes below govern the object's own state-machine and data-model validation, independent of any network
call:

| Code | Meaning | When set |
|---|---|---|
| `0` | No error | Default state after any successful call |
| `101` | General exception | An unexpected failure (e.g. the commit XHR itself errors/times out) |
| `201` | Invalid argument error | `LMSGetValue`/`LMSSetValue` called with a non-string argument |
| `202` | Element cannot have children | A `.` sub-element requested on a non-object CMI element |
| `203` | Element not an array — cannot have count | `._count` requested on a non-array CMI element |
| `301` | Not initialized | Any data-model call before `LMSInitialize` or after `LMSFinish` |
| `401` | Not implemented error | An unrecognized/unsupported CMI element name |
| `402` | Invalid set value, element is a keyword | `LMSSetValue` targeting a read-only computed name (e.g. `cmi.core._children`) |
| `403` | Element is read only | `LMSSetValue` on `cmi.core.student_id`/`student_name`/`credit`/`entry`/`total_time` |
| `404` | Element is write only | `LMSGetValue` on `cmi.core.lesson_status` before it's ever been set (edge case per SCORM's own RTE spec) |
| `405` | Incorrect data type | e.g. a non-numeric string set against `cmi.core.score.raw` |

---

## Non-goals (explicitly out of scope for this contract)

- No SCORM 2004 Sequencing & Navigation endpoints (spec FR-016).
- No xAPI/cmi5 statement endpoints or LRS integration (spec FR-017).
- No package re-versioning/replace endpoint after first launch (spec FR-015/FR-018) — re-upload before
  first launch reuses the same upload-url/import pair.
- No content authoring/editing endpoints (spec FR-018).
