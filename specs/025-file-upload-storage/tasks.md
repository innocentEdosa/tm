---

description: "Task list template for feature implementation"
---

# Tasks: File Upload & Storage

**Input**: Design documents from `/specs/025-file-upload-storage/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/file-attachment-api.md, quickstart.md — all present.

**Tests**: Included, mirroring specs 023/024's own established convention for this codebase's
backend-only features.

**Organization**: Tasks are grouped by user story (spec.md: US1 = P1 "Attach a file to a content item",
US2 = P1 "See what's attached to a content item", US3 = P1 "Download an attached file", US4 = P2
"Remove an attachment").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US4)
- File paths are exact, from plan.md's Project Structure

## Path Conventions

Existing pnpm/Turborepo monorepo — no new top-level project. Backend only:
`apps/api/src/`, `apps/api/drizzle/`, `apps/api/tests/`. No `apps/web` changes (spec is API-only).

---

## Phase 1: Setup

- [x] T001 Feature branch `025-file-upload-storage` checked out from a clean `master` (Constitution Principle X) — already done this session.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The table, RLS, grants, the storage dependency + adapter + test seam, the allowlist, and
the route-plugin skeleton — every user story depends on all of these existing first.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [x] T002 Add `fileAttachments` Drizzle table definition in `apps/api/src/db/schema/file-attachments.ts` per data-model.md (`id`, `tenant_id` FK `tenants.id`, `entity_type` text `CHECK IN ('content_item')`, `entity_id` uuid **no FK** (polymorphic, mirrors `custom_field_values.entity_id`), `file_name`, `content_type`, `size_bytes` bigint, `storage_key` text unique, `status` text `CHECK IN ('pending','ready')` default `'pending'`, `created_by_user_id` FK `users.id` `SET NULL`, `created_at`/`updated_at`, index `(tenant_id, entity_type, entity_id)`)
- [x] T003 Generate and hand-check schema migration `apps/api/drizzle/0079_file_attachments_table.sql` (creates `file_attachments`) from T002 via `pnpm --filter api db:generate` (depends on T002)
- [x] T004 Add migration `apps/api/drizzle/0080_rls_file_attachments.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + standard `tenant_isolation` policy on `file_attachments`, using the hardened `NULLIF(...)` cast (mirrors `0069_rls_course_categories.sql`) (depends on T003)
- [x] T005 Add migration `apps/api/drizzle/0081_lock_file_attachments_grants.sql` — `GRANT SELECT, INSERT, UPDATE, DELETE ON file_attachments TO tm_app` (mirrors `0071_lock_course_catalog_grants.sql`) (depends on T004)
- [x] T006 Apply all pending migrations (`pnpm --filter api db:migrate`) and confirm `file_attachments`, its RLS policy, and the grant all exist — verify directly via `psql` (depends on T005)
- [x] T007 [P] Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` to `apps/api/.env.example` (and a placeholder/comment block in `.env`), documented the same way `MAIL_API_TOKEN` etc. already are (research.md §8)
- [x] T008 Install `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` in `apps/api` (`pnpm --filter api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`) — dependency already explicitly approved during `/speckit-plan` (plan.md Technical Context)
- [x] T009 Implement the `StorageClient` interface in `apps/api/src/storage/storage-client.ts` — `isConfigured()`, `createPresignedUploadUrl(key, contentType, sizeBytes)`, `headObject(key)` returning `{ exists: boolean; sizeBytes?: number }`, `createPresignedDownloadUrl(key)`, `deleteObject(key)` — mirrors `apps/api/src/mail/mail-sender.ts`'s `MailSender` interface shape (research.md §2)
- [x] T010 Implement `R2StorageClient` in `apps/api/src/storage/r2-client.ts` — real AWS SDK v3 `S3Client` pointed at `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, `getSignedUrl` for `PutObjectCommand` (15-minute expiry) and `GetObjectCommand` (1-hour expiry), `HeadObjectCommand` for existence/size verification, `DeleteObjectCommand`; `isConfigured()` returns `false` if any of `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` is missing — mirrors `apps/api/src/mail/zeptomail-sender.ts`'s `ZeptoMailSender` structure (research.md §2) (depends on T008, T009)
- [x] T011 Implement `apps/api/src/storage/storage.ts` — module-level `activeClient: StorageClient = new R2StorageClient()`, `__setStorageClientForTesting(client)` test-only seam, and the exported functions route handlers call; an unconfigured client MUST cause upload requests to fail loudly (`503`), unlike mail's silent-skip behavior (research.md §8) — mirrors `apps/api/src/tenant-auth/mailer.ts`'s `activeSender`/`__setMailSenderForTesting` pattern exactly (depends on T009, T010)
- [x] T012 [P] Implement `RecordingStorageClient` in `apps/api/tests/unit/fixtures/recording-storage-client.ts` — an in-memory fake `StorageClient` recording calls and returning fake presigned URLs, mirrors `apps/api/tests/unit/fixtures/recording-mail-sender.ts`'s `RecordingMailSender` (research.md §2/§9) (depends on T009)
- [x] T013 [P] Implement `apps/api/src/attachments/attachment-allowlist.ts` — a fixed, in-code map `{ content_item: { contentTypes: ["image/jpeg","image/png","image/gif","image/webp","application/pdf"], maxSizeBytes: <tens of MB> } }` with a `validateAgainstAllowlist(entityType, contentType, sizeBytes)` function returning `{ error: string | null }` (research.md §7)
- [x] T014 Created `apps/api/src/attachments/tenant-attachment-routes.ts` as a Fastify plugin and registered it in `apps/api/src/server.ts` — built with all 5 route handlers plus `deleteAllAttachmentsForEntity` directly (T015/T016/T018/T019/T021/T022) rather than as an empty scaffold, matching the precedent every prior spec in this session set for itself (shared `toResponseRow`/`resolveContentItem` helpers were clearer to design once, together) (depends on T002)

**Checkpoint**: Table, RLS, grant, R2 dependency + adapter + test seam, allowlist, and the route-plugin skeleton all exist. User story implementation can begin.

---

## Phase 3: User Story 1 - Attach a file to a content item (Priority: P1) 🎯 MVP

**Goal**: A user holding `course.manage` requests an upload URL, uploads directly to R2 (the API never
receives the bytes), and confirms completion — the foundational capability this entire spec exists for.

**Independent Test**: As a user holding `course.manage`, request an upload URL for a small file
attached to an existing content item, PUT the file's bytes directly to the returned URL, confirm
completion, and see the attachment transition from `pending` to `ready`.

### Implementation for User Story 1

- [x] T015 [US1] Add `POST /tenant/content-items/:contentItemId/attachments` handler in `apps/api/src/attachments/tenant-attachment-routes.ts` — `requirePermission("course.manage")`; `503` if `storage.isConfigured()` (T011) is false, before any other check (research.md §8 — a deliberate deviation from mail's silent-skip, since there's no fallback path that still delivers this feature's value); `400` if `fileName`/`contentType` missing/blank or `sizeBytes` missing/`<= 0`; `404` if `contentItemId` doesn't resolve in the caller's tenant; `422` if `validateAgainstAllowlist("content_item", contentType, sizeBytes)` (T013) returns an error; creates a `pending` row with a fresh `storageKey` (`{tenantId}/content_item/{contentItemId}/{attachmentId}/{fileName}`, data-model.md) and `createdByUserId`: caller (FR-012 — set at creation, not deferred to confirm); calls `storage.createPresignedUploadUrl` (T011); responds `201` with `{ id, uploadUrl }` (contracts §POST) (depends on T011, T013, T014)
- [x] T016 [US1] Add `POST /tenant/attachments/:attachmentId/confirm` handler in the same file — `requirePermission("course.manage")`; `404` if `attachmentId` doesn't resolve in the caller's tenant (or its owning content item no longer resolves); calls `storage.headObject` (T011) and compares the real size against the row's declared `sizeBytes`; on mismatch/missing object responds `409` and leaves the row `pending`; on success sets `status: "ready"`, `updatedAt: now`, responds `200` (contracts §POST confirm) (depends on T011, T015)
- [x] T017 [P] [US1] Integration test `apps/api/tests/integration/attachment-upload-and-confirm.test.ts` — installs `RecordingStorageClient` (T012) via `__setStorageClientForTesting`; covers a successful create + confirm (status transitions `pending` → `ready`), missing-field rejection, out-of-allowlist rejection, cross-tenant/nonexistent `contentItemId` → `404` on create, cross-tenant/nonexistent `attachmentId` → `404` on confirm, a confirm where the recording client reports no object / wrong size → `409`, and forbidden (`403`) for a `course.view`-only caller on both create and confirm (spec US1 Acceptance Scenarios) (depends on T015, T016, T012)

**Checkpoint**: User Story 1 is fully functional and independently testable — the upload/confirm flow works end-to-end against the recording fake.

---

## Phase 4: User Story 2 - See what's attached to a content item (Priority: P1)

**Goal**: A user holding `course.view` or `course.manage` lists a content item's confirmed attachments.

**Independent Test**: With a content item that has two confirmed attachments and one abandoned/pending
one, list its attachments and confirm only the two `ready` ones are returned.

### Implementation for User Story 2

- [x] T018 [US2] Add `GET /tenant/content-items/:contentItemId/attachments` handler in `apps/api/src/attachments/tenant-attachment-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; `404` if `contentItemId` doesn't resolve in the caller's tenant; returns only `status: "ready"` attachments, ordered by `createdAt`, joining `users` for `createdBy` full name; empty array for zero attachments (contracts §GET list) (depends on T014)

**Checkpoint**: User Stories 1 AND 2 both work independently — attachments can be created and listed.

---

## Phase 5: User Story 3 - Download an attached file (Priority: P1)

**Goal**: A user holding `course.view` or `course.manage` retrieves a time-limited download link for a
confirmed attachment.

**Independent Test**: As a user holding `course.view`, request a download link for a confirmed
attachment and confirm a `pending` or nonexistent attachment id is rejected as not found.

### Implementation for User Story 3

- [x] T019 [US3] Add `GET /tenant/attachments/:attachmentId/download-url` handler in `apps/api/src/attachments/tenant-attachment-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; `404` if `attachmentId` doesn't resolve in the caller's tenant or is not `status: "ready"`; calls `storage.createPresignedDownloadUrl` (T011); responds `200` with `{ downloadUrl }` (contracts §GET download-url) (depends on T011, T014)
- [x] T020 [P] [US3] Integration test `apps/api/tests/integration/attachment-list-and-download.test.ts` — covers both US2 and US3 together: list returns only `ready` attachments in order, empty list for zero attachments, cross-tenant `contentItemId` → `404` on list, forbidden (`403`) on list for a no-permission caller; download-url success for a `ready` attachment, `404` for a `pending` or nonexistent attachment id, cross-tenant attachment id → `404`, forbidden (`403`) for a no-permission caller on download-url (spec US2 + US3 Acceptance Scenarios) (depends on T015, T016, T018, T019, T012)

**Checkpoint**: User Stories 1, 2, AND 3 all work independently — the full upload → list → download loop works end-to-end.

---

## Phase 6: User Story 4 - Remove an attachment (Priority: P2)

**Goal**: A user holding `course.manage` deletes an attachment (removing both the storage object and
the record), and the system provides a bulk-delete-for-entity capability for future callers.

**Independent Test**: As a user holding `course.manage`, delete a confirmed attachment and confirm a
subsequent download-link request for it is rejected as not found.

### Implementation for User Story 4

- [x] T021 [US4] Add `DELETE /tenant/attachments/:attachmentId` handler in `apps/api/src/attachments/tenant-attachment-routes.ts` — `requirePermission("course.manage")`; `404` if `attachmentId` doesn't resolve in the caller's tenant; calls `storage.deleteObject` (T011) then deletes the row; responds `200` (contracts §DELETE) (depends on T011, T014)
- [x] T022 [US4] Implement and export `deleteAllAttachmentsForEntity(tenantDb, entityType, entityId)` in `apps/api/src/attachments/tenant-attachment-routes.ts` (or a small shared module in the same directory if that reads cleaner) — selects every matching row's `storageKey`, calls `storage.deleteObject` (T011) for each, then deletes all matching rows in one statement; not wired to any HTTP route or any existing entity's delete handler in this spec (spec FR-009/Assumptions — that wiring is named follow-up work) (depends on T011)
- [x] T023 [P] [US4] Integration test `apps/api/tests/integration/attachment-delete.test.ts` — covers a successful delete (removed from list, download-url now `404`), cross-tenant/nonexistent `attachmentId` → `404`, forbidden (`403`) for a `course.view`-only caller, and a direct (non-HTTP) call to `deleteAllAttachmentsForEntity` confirming every attachment for a given entity is removed in one call (spec US4 Acceptance Scenarios + FR-009) (depends on T021, T022, T012)

**Checkpoint**: All four user stories are independently functional — the full spec scope is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification work that spans or sits outside individual user stories.

- [x] T024 [P] Unit test `apps/api/tests/unit/r2-client.test.ts` — mirrors `zeptomail-sender.test.ts`'s treatment of `ZeptoMailSender`: exercises `R2StorageClient`'s `isConfigured()` (true/false across missing-env-var combinations) and its request-shaping logic (storage key passed through correctly, expiry values used) without a real network call (depends on T010)
- [x] T025 [P] Validate quickstart.md's six scenarios: Scenarios 1-5 (upload/confirm/list/download/allowlist-reject/delete) are covered by the automated integration tests above (T017, T020, T023) using `RecordingStorageClient`, so no real R2 credentials are required to consider this spec's automated coverage complete. Scenario 6 (tenant isolation/permission gating) is covered by the `404`/`403` cases already present in T017/T020/T023 — no separate consolidated sweep file is needed given this spec's five-route surface already has full per-story coverage. A true live-R2 walkthrough (actually PUTting/GETting real bytes against a real bucket) is optional manual verification requiring real Cloudflare credentials not available in this environment — noted here rather than silently skipped (depends on T017, T020, T023)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — already complete (T001).
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion.
  - US1 (Phase 3) has no dependency on any other story.
  - US2 (Phase 4) depends only on Foundational (T014) — no dependency on US1's handlers, though its
    own integration test (T020, filed under US3) needs US1's create/confirm handlers to have test data
    to list.
  - US3 (Phase 5) depends only on Foundational for its own handler (T019); its integration test (T020)
    depends on US1 (T015/T016) and US2 (T018) to have something to list and download.
  - US4 (Phase 6) depends only on Foundational for its own handlers (T021/T022); its integration test
    (T023) depends on US1 (T015/T016) to have something to delete.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Within Each User Story

- Route handlers before their integration test.
- Story complete before moving to the next priority (or in parallel, per staffing).

### Parallel Opportunities

- T007 (.env.example) and T008 (dependency install) are independent of each other and of T002-T006 (DB
  migration chain) — all can proceed in parallel once Foundational phase starts.
- T012 (RecordingStorageClient) and T013 (allowlist) are independent of T010/T011 (real R2 adapter) —
  only need the interface (T009).
- All `[P]`-marked integration/unit test tasks (T017, T020, T023, T024, T025) can run in parallel with
  each other once their respective implementation tasks land.
- US2's handler (T018) and US3's handler (T019) can be built in parallel by two developers — both only
  depend on Foundational, not on each other or on US1.

---

## Parallel Example: Foundational Phase

```bash
# Once T002-T006 (DB chain) and T009 (interface) are underway, these can proceed in parallel:
Task: "Add R2 env vars to apps/api/.env.example"
Task: "Install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner"
Task: "Implement RecordingStorageClient in tests/unit/fixtures/recording-storage-client.ts"
Task: "Implement attachment-allowlist.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (already done).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run T017 independently (upload URL request → confirm → `ready`).
5. An attachment nobody can list or download is unverifiable in practice — User Story 2 (list) is the
   natural next increment.

### Incremental Delivery

1. Complete Setup + Foundational → foundation ready (including the storage adapter and its test seam).
2. Add User Story 1 → test independently (upload + confirm).
3. Add User Story 2 → test independently (list).
4. Add User Story 3 → test independently (download) → this is the first point the feature is genuinely
   usable end-to-end (upload something, then get it back).
5. Add User Story 4 → test independently (delete + bulk-delete-for-entity).
6. Phase 7 polish → full spec scope verified via automated tests; live-R2 manual check optional.

### Parallel Team Strategy

With multiple developers: all complete Setup + Foundational together (including the storage adapter,
since every story depends on it). Once Foundational lands, US1, US2, and US3's handlers can all proceed
in parallel (none depend on each other's handler code, only on their own integration test needing US1's
data to exist) — US4 similarly only needs US1 for its own test data.

---

## Notes

- `[P]` tasks = different files, or same file with non-overlapping handlers and no completion-order
  dependency.
- `[Story]` label maps task to specific user story for traceability.
- Every user story is independently completable and testable against its own (or a shared,
  explicitly-noted) integration test file.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
- No route in this task list ever causes the API server to receive a file's bytes — every upload and
  download interaction with R2 happens via a presigned URL the client uses directly (spec FR-003).
