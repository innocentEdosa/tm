# Contract: File Attachment API

All routes live in a new `apps/api/src/attachments/tenant-attachment-routes.ts` plugin, registered in
`server.ts` alongside the other tenant-scoped route plugins. Every route requires
`requireTenantUserSession()` first, then the stated permission (reused from spec 023/024 — no new
permission keys), and operates through `request.tenantDb` (RLS-scoped to the caller's own tenant — no
route ever takes or trusts a client-supplied tenant id). Every route resolves its target content item
via `request.tenantDb` first — a cross-tenant or nonexistent content item id is rejected as `404`
before any attachment logic runs.

## `POST /tenant/content-items/:contentItemId/attachments`

**Permission**: `course.manage`.

**Body**: `{ fileName: string; contentType: string; sizeBytes: number }`.

**Behavior**:
1. `503` if the storage client isn't configured (`storage.isConfigured()` is false, research.md §8) —
   checked before any other validation, since there is no fallback path that still delivers this
   feature's value without storage.
2. `404` if `contentItemId` doesn't resolve in the caller's tenant.
3. `400` if `fileName`/`contentType` missing/blank, or `sizeBytes` missing/`<= 0`.
4. `422` if `contentType` or `sizeBytes` falls outside the fixed allowlist for `content_item`
   attachments (research.md §7).
5. Creates a `pending` `file_attachments` row (`entityType: "content_item"`, `entityId:
   contentItemId`), with a fresh, tenant-namespaced `storageKey` (research.md §6) and `createdByUserId`
   set to the caller at this creation step (FR-012 — not deferred to confirm).
6. Requests a presigned `PutObject` URL (15-minute expiry) scoped to that `storageKey`.

**Response** `201`:
```json
{ "success": true, "data": { "id": "uuid", "uploadUrl": "https://..." } }
```

**Errors**: `400`/`404`/`422`/`503` per above. `403` if the caller lacks `course.manage`.

---

## `POST /tenant/attachments/:attachmentId/confirm`

**Permission**: `course.manage`.

**Behavior**:
1. `404` if `attachmentId` doesn't resolve in the caller's tenant, or if its owning content item no
   longer resolves in the caller's tenant.
2. Calls `HeadObject` against R2 for the attachment's `storageKey`. If the object doesn't exist, or its
   real size doesn't match the `sizeBytes` declared at request time, the row stays `pending` and the
   response is `409` (`{ "success": false, "message": "Upload not found in storage, or size mismatch"
   }`) — **not** an automatic retry or silent success.
3. On successful verification, sets `status: "ready"`, `updatedAt: now`.

**Response** `200`: the confirmed attachment (see shape under `GET .../attachments` below).

**Errors**: `404`/`409` per above. `403` if the caller lacks `course.manage`.

---

## `GET /tenant/content-items/:contentItemId/attachments`

**Permission**: `course.view` (or `course.manage`).

**Response** `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fileName": "slide-deck.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 2048576,
      "createdBy": { "id": "uuid", "fullName": "string" } | null,
      "createdAt": "ISO-8601"
    }
  ]
}
```
Only `ready` attachments are included (spec FR-006) — `pending` ones are invisible here. Empty array
for a content item with zero confirmed attachments (spec Edge Cases) — never an error.

**Errors**: `404` if `contentItemId` doesn't resolve in the caller's tenant. `403` if the caller holds
neither permission.

---

## `GET /tenant/attachments/:attachmentId/download-url`

**Permission**: `course.view` (or `course.manage`).

**Behavior**: `404` if `attachmentId` doesn't resolve in the caller's tenant, or is not `status:
"ready"` (a `pending` attachment is treated identically to nonexistent — spec US3 AS2). Requests a
presigned `GetObject` URL (1-hour expiry).

**Response** `200`:
```json
{ "success": true, "data": { "downloadUrl": "https://..." } }
```

**Errors**: `404` per above. `403` if the caller holds neither permission.

---

## `DELETE /tenant/attachments/:attachmentId`

**Permission**: `course.manage`.

**Behavior**: `404` if `attachmentId` doesn't resolve in the caller's tenant. Deletes the R2 object
first, then the `file_attachments` row (hard delete — no archive/soft-delete state exists for
attachments).

**Response** `200`: `{ "success": true }`.

**Errors**: `404` per above. `403` if the caller lacks `course.manage`.

---

## Internal capability (not an HTTP route): bulk-delete for an entity

`deleteAllAttachmentsForEntity(tenantDb, entityType, entityId): Promise<void>` — exported from the
attachments module for a future caller (e.g. a modified content-item delete handler in spec 024) to
invoke directly, so attachments are never silently orphaned when their owning entity is deleted
(spec FR-009). **Not wired into any existing delete route by this spec** — that wiring is named
follow-up work (spec Assumptions), not assumed to happen automatically.

---

## Non-goals (explicitly out of scope for this contract)

- No multi-file/archive upload endpoint — every attachment is exactly one file (spec FR-013).
- No malware-scan status field or endpoint (spec FR-014).
- No storage-quota/usage endpoint (spec FR-015).
- No thumbnail/transcode endpoint (spec FR-016).
- No "replace this attachment's file" endpoint — delete and re-upload instead (spec FR-017).
- No generic `/tenant/attachments?entityType=&entityId=` surface — every route in this contract is
  content-item-scoped (research.md §4); a future entity type gets its own thin route wrapper.
