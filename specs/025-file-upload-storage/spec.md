# Feature Specification: File Upload & Storage

**Feature Branch**: `025-file-upload-storage`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "File Upload & Storage — generic, tenant-scoped file attachment capability for the TM multi-tenant SaaS, the first of two prerequisite specs (this one, then Learner Progress / Attempt Tracking) needed before a SCORM 1.2 Runtime spec can be built on top of them. Storage backend: Cloudflare R2 (S3-compatible object storage) — a new dependency requiring explicit sign-off per Constitution Principle XIII, since no built-in Node/Fastify utility can sign S3-compatible presigned URLs (AWS Signature V4) without hand-rolling a security-sensitive algorithm; propose an S3-compatible client library (e.g. @aws-sdk/client-s3 plus @aws-sdk/s3-request-presigner) with justification, and do not install anything without explicit go-ahead. Scope: a generic, polymorphic file/attachment entity (tenant-scoped, entity type + entity id, no DB-level foreign key — mirrors the existing custom_field_values polymorphic pattern already used in this codebase) so any future entity type (course content items first, but not hardcoded to only that) can attach files without a schema change. Upload flow is direct-to-R2 via a presigned PUT URL the API issues (the API server never receives file bytes directly, avoiding body-size limits and keeping large uploads off the request path) — client requests an upload URL with file name/content type/size and the entity it's attaching to, server validates permission and a file-type/size allowlist appropriate to that entity type, creates a pending file record, returns a presigned PUT URL scoped to a tenant-namespaced storage key; client uploads directly to R2; client confirms completion, server verifies the object exists in R2 and marks the record ready. Download flow is a presigned, time-limited GET URL (not proxied through the API) so downloads also stay off the API's data path. Delete removes both the R2 object and the file record (hard delete, no soft-delete/archive — matches how Course Content's content items are deleted, spec 024). Explicitly out of scope for this spec, to be documented as flagged future work: multi-file/archive upload and extraction (a ZIP containing many files, e.g. a SCORM package, is the SCORM Runtime spec's own job, built on top of this single-file primitive rather than this spec doing archive extraction itself); virus/malware scanning; storage quotas or plan-tier storage limits; image/video transcoding or thumbnail generation; file versioning (re-uploading a new version of an already-attached file). Permissions: no new dedicated file-management permission keys for this first spec — an upload/delete is gated by whatever permission already governs write access to the entity the file is being attached to (e.g. course.manage for a course-content-item attachment), and download/view is gated by whatever permission already governs read access to that same entity — this spec should flag if that per-entity-type permission delegation proves awkward once a second consumer entity type exists, rather than inventing a new generic file permission preemptively."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach a file to a content item (Priority: P1)

An L&D admin holding `course.manage` uploads a file — a document, an image — and attaches it to an
existing content item, without the file's bytes ever passing through the API server itself.

**Why this priority**: Nothing else in this spec is useful without a way to get a file in — this is the
foundational capability, and the entire reason this spec exists (it directly unblocks the SCORM Runtime
spec's own package-upload need).

**Independent Test**: As a user holding `course.manage`, request an upload URL for a small file
attached to an existing content item, PUT the file's bytes directly to the returned URL, confirm
completion, and see the attachment appear in that content item's attachment list.

**Acceptance Scenarios**:

1. **Given** a content item, **When** a user holding `course.manage` requests an upload URL with a
   valid file name, content type, and size, **Then** a pending attachment record is created and a
   presigned upload URL scoped to that record is returned.
2. **Given** a presigned upload URL, **When** the client PUTs the file's bytes directly to it, **Then**
   the API server itself never receives those bytes.
3. **Given** a completed direct upload, **When** the client confirms completion, **Then** the server
   verifies the object exists in storage and marks the attachment `ready`.
4. **Given** an upload URL request whose declared content type or size falls outside the allowlist for
   content-item attachments, **When** submitted, **Then** it is rejected before any storage interaction
   occurs.
5. **Given** a create request targeting a content item id that doesn't resolve in the caller's tenant,
   **When** submitted, **Then** it is rejected as not found.
6. **Given** a user holding only `course.view` (no `course.manage`), **When** they attempt to request an
   upload URL, **Then** the request is rejected as forbidden.

---

### User Story 2 - See what's attached to a content item (Priority: P1)

Anyone holding `course.view` or `course.manage` lists the attachments on a content item, so they know
what exists before deciding to download or remove one.

**Why this priority**: An upload capability nobody can read back is unverifiable; independently
testable as soon as User Story 1 can create data to list.

**Independent Test**: With a content item that has two confirmed attachments and one abandoned/pending
one, list its attachments and confirm only the two `ready` ones are returned.

**Acceptance Scenarios**:

1. **Given** a content item with confirmed attachments, **When** a user holding `course.view` lists
   them, **Then** every `ready` attachment is returned, ordered by upload time; attachments still
   `pending` (never confirmed) are excluded from the default list.
2. **Given** a content item with zero attachments, **When** its attachment list is requested, **Then**
   an empty list is returned, not an error.
3. **Given** a content item id belonging to a different tenant, **When** any user requests its
   attachment list, **Then** the request is rejected as not found.
4. **Given** a user holding neither `course.view` nor `course.manage`, **When** they request an
   attachment list, download link, or upload URL, **Then** the request is rejected as forbidden.

---

### User Story 3 - Download an attached file (Priority: P1)

Anyone holding `course.view` or `course.manage` retrieves a time-limited link to download a specific
attachment, without the file's bytes passing through the API server.

**Why this priority**: Attaching a file nobody can retrieve is pointless; this closes the loop on User
Stories 1-2 and is independently testable once an attachment is confirmed.

**Independent Test**: As a user holding `course.view`, request a download link for a confirmed
attachment and confirm it resolves to the file's actual bytes.

**Acceptance Scenarios**:

1. **Given** a confirmed (`ready`) attachment, **When** a user holding `course.view` or `course.manage`
   requests its download link, **Then** a time-limited, presigned URL resolving directly to the file in
   storage is returned.
2. **Given** an attachment id that is still `pending` (never confirmed) or doesn't exist, **When** a
   download link is requested, **Then** the request is rejected as not found.
3. **Given** an attachment id belonging to a different tenant, **When** a download link is requested,
   **Then** the request is rejected as not found.

---

### User Story 4 - Remove an attachment (Priority: P2)

An L&D admin holding `course.manage` deletes an attachment that's no longer needed, removing it from
both storage and the record.

**Why this priority**: Correcting a mistaken upload is useful once creation/read access exist, but the
capability is usable without it in the short term.

**Independent Test**: As a user holding `course.manage`, delete a confirmed attachment and confirm it no
longer appears in the content item's attachment list, and that a subsequent download-link request for
it is rejected as not found.

**Acceptance Scenarios**:

1. **Given** a confirmed attachment, **When** a user holding `course.manage` deletes it, **Then** it is
   removed from both storage and the attachment list, and any subsequent request for it (list, download
   link) is rejected as not found.
2. **Given** a delete request targeting an attachment id in a different tenant, **When** submitted,
   **Then** it is rejected as not found.
3. **Given** a user holding only `course.view`, **When** they attempt to delete an attachment, **Then**
   the request is rejected as forbidden.

---

### Edge Cases

- What happens when an upload URL is requested but the client never actually uploads anything? The
  attachment record stays `pending` indefinitely in this spec — no automatic cleanup (see Assumptions).
- What happens when a client confirms an upload but the object doesn't actually exist in storage, or its
  size doesn't match what was declared? Rejected — the record stays `pending`, never transitions to
  `ready`.
- What happens when a content item with attachments is itself deleted? This spec has no database-level
  cascade (the attachment entity is deliberately polymorphic with no foreign key), so content-item
  deletion cannot automatically remove its attachments at the database layer — see Assumptions for the
  required follow-up.
- What happens when two uploads are requested for the same content item at the same time? No conflict —
  each is an independent attachment record with its own storage key.
- What happens when a request omits authentication entirely? Rejected as unauthorized, before permission
  checks run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users holding `course.manage` to request an upload URL for a file to be
  attached to an existing content item, given a file name, declared content type, and declared size.
- **FR-002**: System MUST create a `pending` attachment record before issuing the upload URL, and MUST
  scope the returned presigned upload URL to that record's own storage location.
- **FR-003**: System MUST NOT require the API server to receive a file's bytes at any point in the
  upload flow — the client uploads directly to storage using the presigned URL.
- **FR-004**: System MUST allow the client to confirm upload completion, at which point the system MUST
  verify the object exists in storage (and that its size matches what was declared) before marking the
  attachment `ready`; a failed verification MUST leave the attachment `pending`, not `ready`.
- **FR-005**: System MUST reject an upload URL request whose declared content type or size falls outside
  the fixed allowlist for content-item attachments, before any storage interaction occurs.
- **FR-006**: System MUST allow users holding `course.view` or `course.manage` to list a content item's
  `ready` attachments (excluding `pending` ones from the default list).
- **FR-007**: System MUST allow users holding `course.view` or `course.manage` to request a
  time-limited, presigned download URL for a specific `ready` attachment; a request for a `pending` or
  nonexistent attachment id MUST be rejected as not found.
- **FR-008**: System MUST allow users holding `course.manage` to delete an attachment, removing both the
  underlying storage object and the attachment record (hard delete — no soft-delete/archive state for
  attachments).
- **FR-009**: System MUST provide a way to delete every attachment belonging to a given entity in one
  operation, for use by that entity's own deletion flow (e.g. a future change to Course Content's
  content-item delete route) so attachments are never silently orphaned when their owning entity is
  removed — this spec provides the capability; wiring an existing entity's delete route to call it is
  named as required follow-up work, not assumed to happen automatically (see Assumptions).
- **FR-010**: System MUST scope every attachment record and every attachment operation to the requesting
  user's own tenant, server-side, regardless of any tenant identifier the client supplies; requests
  targeting another tenant's content item or attachment id MUST be rejected as not found.
- **FR-011**: System MUST reject upload, confirm, delete, and bulk-delete requests from users who lack
  `course.manage`, and MUST reject list and download-link requests for users who hold neither
  `course.view` nor `course.manage` — reusing the existing course-level permissions; no new permission
  keys are introduced in this spec.
- **FR-012**: System MUST record `createdBy`/`createdAt` on an attachment at creation time (when the
  `pending` record is first inserted, not deferred until confirmation) — matching this codebase's
  standard audit-field convention (e.g. courses, spec 023) rather than the `updated_at` field's own
  confirm-time refresh.
- **FR-013**: System MUST NOT support uploading or extracting a multi-file archive (e.g. a ZIP) in this
  feature — every attachment is exactly one file; multi-file package handling is explicitly deferred to
  the SCORM Runtime spec, built on top of this single-file primitive.
- **FR-014**: System MUST NOT scan uploaded files for malware or viruses in this feature — explicitly
  deferred future work.
- **FR-015**: System MUST NOT enforce storage quotas or plan-tier storage limits in this feature —
  explicitly deferred future work.
- **FR-016**: System MUST NOT transcode media or generate thumbnails/previews in this feature —
  explicitly deferred future work.
- **FR-017**: System MUST NOT support replacing an existing attachment with a new version in place —
  explicitly deferred future work; replacing a file means deleting the old attachment and uploading a
  new one.

### Key Entities *(include if feature involves data)*

- **File Attachment**: A tenant-scoped record representing exactly one uploaded file. Attributes: the
  owning entity (an entity type — only `content_item` is wired to a real route surface in this spec —
  plus an entity id, deliberately with no database-level foreign key, mirroring the existing
  polymorphic custom-field-value pattern already used in this codebase, so a future entity type can
  reuse this same table without a schema change), file name, declared content type, declared size,
  underlying storage location, status (`pending` / `ready`), and audit fields (created by, created at).
  Belongs to exactly one tenant. Has no relationship to multi-file packages, malware-scan results, or
  version history in this spec — all explicitly deferred.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uploading a file never fails or times out due to the API server's own request-size
  handling, regardless of file size, because the server never receives the file's bytes directly.
- **SC-002**: 100% of list, download-link, and delete requests targeting a content item or attachment
  belonging to a different tenant are rejected, verified by automated test.
- **SC-003**: 100% of upload, list, download-link, and delete calls from users lacking the relevant
  permission are rejected, verified by automated test.
- **SC-004**: A confirmed attachment's download link remains retrievable at any point after upload, not
  only immediately afterward.
- **SC-005**: 0% of uploads whose declared size or content type falls outside the allowlist reach
  storage — every one is rejected at the upload-URL-request step.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change to the isolation model — the attachment table follows the
  existing shared-schema-with-`tenant_id`-scoping pattern (Principle I). Storage keys are additionally
  tenant-namespaced at the application layer (object storage itself has no native tenant concept) as
  defense-in-depth, not as the primary isolation mechanism.
- **Tenant-configurable vs. fixed platform-wide**: No new permission keys — reuses `course.view`/
  `course.manage` since content items are the only wired entity type. The file-type/size allowlist for
  content-item attachments is fixed platform-wide in this spec, not tenant-configurable — flagged as a
  candidate for a future tenant-configurable-limits follow-up if a tenant needs different limits.
- **AI-generation review/approval step**: N/A — this spec stores arbitrary uploaded files; it generates
  no AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec touches no evaluation or ROI data.
- **Downgrade/cancellation behavior**: N/A in this spec specifically, but flagged: storage quotas and any
  plan-tier storage limits are explicitly deferred (FR-015), so a future storage-quota spec must define
  downgrade/cancellation behavior for storage before quotas are enforced.
- **Design system reference**: N/A — this spec ships no UI; it is API/data-model only, matching specs
  023/024's own scope pattern. The upload itself is a direct client-to-storage PUT that a future UI spec
  would drive.
- **Demoable vs. internal**: Internal/infrastructure-only. Demoable only via direct API calls (request an
  upload URL, PUT a file with `curl`, confirm, list, download) — not to a non-technical stakeholder
  until a follow-up UI spec exists.

## Assumptions

- **New dependency**: an S3-compatible client and presigned-URL signer (e.g. `@aws-sdk/client-s3` plus
  `@aws-sdk/s3-request-presigner`) is required — no built-in Node/Fastify utility can correctly sign
  S3-compatible presigned URLs (AWS Signature V4) without hand-rolling a security-sensitive algorithm.
  Per Constitution Principle XIII, this requires explicit sign-off before any install command runs; the
  planning phase for this spec must obtain that sign-off explicitly, not assume it.
- Content items (spec 024) are the only entity type wired to real HTTP routes in this spec. The
  underlying `File Attachment` entity and service layer are generic/polymorphic so a future entity type
  (e.g. courses themselves, or a future assignment/submission entity) can reuse the same table via its
  own thin route wrapper, without a schema change.
- File-type/size allowlist for content-item attachments in this first spec: common image formats
  (jpg/png/gif/webp) and PDF documents, up to a moderate size cap (tens of megabytes) — a reasonable
  default for "attachments," not media/SCORM-package hosting. The SCORM Runtime spec will define its own
  much larger allowlist (zip packages) on top of this same underlying primitive, not by loosening this
  one.
- No automatic cleanup/garbage collection of abandoned `pending` upload records exists in this spec —
  explicitly deferred future work.
- Content items' own `DELETE /tenant/content-items/:contentItemId` route (spec 024) is **not** modified
  by this spec to call the new bulk-delete-for-entity capability (FR-009) — that wiring is necessary
  follow-up work, named explicitly here so it is not silently forgotten, matching how spec 024 itself
  named forward-looking follow-up work for future specs.
- Presigned URLs (both upload and download) are time-limited; exact durations are a planning-level
  detail, not fixed in this spec.
- This is an API-only feature — no web UI ships as part of this spec, matching specs 023/024's own scope
  pattern.
