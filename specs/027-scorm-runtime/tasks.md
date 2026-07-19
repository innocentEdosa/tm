---

description: "Task list template for feature implementation"
---

# Tasks: SCORM 1.2 Runtime

**Input**: Design documents from `/specs/027-scorm-runtime/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/scorm-runtime-api.md, quickstart.md — all present.

**Tests**: Included, mirroring specs 023/024/025/026's own established convention for this codebase's
features (with a new unit-test category for manifest parsing, since this spec's first genuine parsing
logic has no prior direct precedent).

**Organization**: Tasks are grouped by user story (spec.md: US1 = P1 "Import a SCORM package into a
content item", US2 = P1 "Launch and play a SCORM package as a learner", US3 = P1 "Persist and resume
runtime state across sessions", US4 = P2 "Navigate between multiple SCOs in a package").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US4)
- File paths are exact, from plan.md's Project Structure

## Path Conventions

Existing pnpm/Turborepo monorepo — no new top-level project. **This spec touches both `apps/api` and
`apps/web`** — the first in this sequence to do so (specs 023-026 were `apps/api`-only).

---

## Phase 1: Setup

- [x] T001 Feature branch `027-scorm-runtime` checked out from a clean `master` (Constitution Principle X, after specs 025 and 026 were both fast-forward-merged in) — already done this session.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The four tables, RLS, grants, the extended storage primitive, the manifest parser, and the
shared test fixture builder — every user story depends on all of these existing first.

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [x] T002 Add `scormPackages`, `scormPackageItems`, `scormCmiObjectives`, `scormCmiInteractions` Drizzle table definitions in `apps/api/src/db/schema/scorm.ts` per data-model.md — `scormPackages` (id, tenantId FK, title nullable, createdByUserId FK `SET NULL`, createdAt); `scormPackageItems` (id, tenantId FK, packageId FK `scormPackages.id` `CASCADE`, contentItemId FK `content_items.id` `CASCADE` **unique**, manifestItemIdentifier, entryPointRelativePath, position, unique `(packageId, position)`, index `(tenantId, packageId)`); `scormCmiObjectives` (id, tenantId FK, userId FK, contentItemId uuid **no FK**, objectiveIndex, objectiveId nullable, status nullable, scoreRaw/scoreMin/scoreMax numeric(12,4) nullable, unique `(tenantId, userId, contentItemId, objectiveIndex)`); `scormCmiInteractions` (id, tenantId FK, userId FK, contentItemId uuid **no FK**, interactionIndex, interactionId nullable, type nullable, weighting numeric(12,4) nullable, studentResponse nullable, result nullable, latency nullable, correctResponses jsonb nullable, unique `(tenantId, userId, contentItemId, interactionIndex)`)
- [x] T003 Generate and hand-check schema migration `apps/api/drizzle/0085_scorm_tables.sql` (creates all four tables) from T002 via `pnpm --filter api db:generate` (depends on T002)
- [x] T004 [P] Add migration `apps/api/drizzle/0086_rls_scorm_packages.sql` — `ENABLE`/`FORCE ROW LEVEL SECURITY` + standard hardened `tenant_isolation` policy on `scorm_packages` (mirrors `0083_rls_learner_content_progress.sql`) (depends on T003)
- [x] T005 [P] Add migration `apps/api/drizzle/0087_rls_scorm_package_items.sql` — same pattern on `scorm_package_items` (depends on T003)
- [x] T006 [P] Add migration `apps/api/drizzle/0088_rls_scorm_cmi_objectives.sql` — same pattern on `scorm_cmi_objectives` (depends on T003)
- [x] T007 [P] Add migration `apps/api/drizzle/0089_rls_scorm_cmi_interactions.sql` — same pattern on `scorm_cmi_interactions` (depends on T003)
- [x] T008 Add migration `apps/api/drizzle/0090_lock_scorm_grants.sql` — `GRANT SELECT, INSERT, UPDATE, DELETE ON scorm_packages, scorm_package_items, scorm_cmi_objectives, scorm_cmi_interactions TO tm_app` (depends on T004, T005, T006, T007)
- [x] T009 Apply all pending migrations (`pnpm --filter api db:migrate`) and confirm all four tables, their RLS policies, and the grants all exist — verify directly via `psql` against the local dev database (re-verify `DATABASE_URL` points at local Postgres, not production, before running) (depends on T008)
- [x] T010 Install `adm-zip` and `fast-xml-parser` in `apps/api` (`pnpm --filter api add adm-zip fast-xml-parser` plus `pnpm --filter api add -D @types/adm-zip`) — dependency already explicitly approved during `/speckit-plan` (plan.md Technical Context)
- [x] T011 [P] Extend the `StorageClient` interface in `apps/api/src/storage/storage-client.ts` — add `putObject(key: string, body: Buffer, contentType: string): Promise<void>` and `getObjectStream(key: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string } | null>` (research.md §3)
- [x] T012 Implement `R2StorageClient.putObject`/`getObjectStream` in `apps/api/src/storage/r2-client.ts` — real `PutObjectCommand`/`GetObjectCommand` (not presigned — server-side direct calls); `getObjectStream` catches `NotFound`/`NoSuchKey` and returns `null` (mirrors `headObject`'s existing error-handling pattern) (depends on T010, T011)
- [x] T013 Add `putObject`/`getObjectStream` passthrough functions to `apps/api/src/storage/storage.ts` (depends on T011, T012)
- [x] T014 [P] Extend `RecordingStorageClient` in `apps/api/tests/unit/fixtures/recording-storage-client.ts` — an in-memory `Map<string, { body: Buffer; contentType: string }>` backing the new `putObject`/`getObjectStream` methods (depends on T011)
- [x] T015 [P] Implement `apps/api/tests/unit/fixtures/build-test-scorm-package.ts` — constructs a valid, minimal SCORM 1.2 `.zip` in memory using `adm-zip` (an `imsmanifest.xml` with a configurable number of `<item>`s, each with a trivial `index.html` entry point referencing one relative asset e.g. a tiny `style.css`), returning a `Buffer`; used by every integration test below instead of a committed binary fixture (plan.md Testing) (depends on T010)
- [x] T016 Implement `apps/api/src/scorm/manifest-parser.ts` — `parseManifest(xml: string): { title: string | null; items: { identifier: string; title: string | null; entryPointRelativePath: string }[] } | { error: string }` using `fast-xml-parser`: extracts `<organizations>/<organization>/<item>` tree (flattened, ignoring nested grouping-only items with no `<resource>`), resolves each item's `identifierref` to its `<resources>/<resource href="...">`, returns an error (not a throw) for a missing/malformed manifest or an unresolvable resource reference (spec FR-002) (depends on T010)
- [x] T017 [P] Unit test `apps/api/tests/unit/manifest-parser.test.ts` — covers a single-item manifest, a multi-item manifest (order preserved), a manifest missing `imsmanifest.xml`'s expected root structure, and an item whose `identifierref` doesn't resolve to any `<resource>` (depends on T016)

**Checkpoint**: Tables, RLS, grants, extended storage primitive, manifest parser, and shared test-fixture
builder all exist. User story implementation can begin.

---

## Phase 3: User Story 1 - Import a SCORM package into a content item (Priority: P1) 🎯 MVP

**Goal**: A user holding `course.manage` uploads a SCORM `.zip`, and the system extracts it, parses its
manifest, and creates one content item per SCO (single-SCO packages: just the uploaded-to item itself;
multi-SCO: additional sibling content items created and grouped under one `scorm_packages` record).

**Independent Test**: As a user holding `course.manage`, upload a small valid single-SCO package and
confirm no additional content items are created; upload a two-SCO package to a different content item
and confirm exactly one additional content item is created, positioned immediately after the original.

### Implementation for User Story 1

- [x] T018 [US1] Implement `apps/api/src/scorm/package-importer.ts` — `importPackage(tenantDb, tenantId, contentItemId, zipBuffer): Promise<{ packageId: string; scos: { contentItemId: string; title: string; position: number }[] } | { error: string }>`: extracts with `adm-zip`, locates `imsmanifest.xml` at the archive root (`error` if missing/invalid archive), calls `manifest-parser.ts` (T016) (`error` on parse failure), rejects if any resolved entry-point file is missing from the archive (spec US1 AS4); on success, in one transaction: inserts one `scorm_packages` row; for the first manifest item, updates the uploaded-to content item's `title`/`payload` in place; for each additional item, inserts a new `content_items` row (type `external_import`, `payload.sourceType: "scorm"`, positioned immediately after the anchor in the module, shifting later siblings' `position` by the same pattern already used in `course-content`'s reorder logic) and a `scorm_package_items` row per SCO (including the anchor); uploads every extracted file to R2 via `storage.putObject` (T013) under `{tenantId}/scorm/{packageId}/{relativePath}` (depends on T009, T013, T016)
- [x] T019 [US1] Add `POST /tenant/content-items/:contentItemId/scorm/upload-url` handler in `apps/api/src/scorm/tenant-scorm-upload-routes.ts` — `requirePermission("course.manage")`; `404` if `contentItemId` doesn't resolve in the caller's tenant or isn't `type: "external_import"` with `payload.sourceType: "scorm"`; `422` if `sizeBytes` missing/`<= 0`/exceeds 500MB; `409` if a `scorm_package_items` row already exists for this content item; creates a fresh `storageKey` (`{tenantId}/scorm-raw/{contentItemId}/{uploadId}.zip`) and calls `storage.createPresignedUploadUrl`; responds `201` with `{ uploadUrl, storageKey }` (contracts §POST upload-url) (depends on T013)
- [x] T020 [US1] Add `POST /tenant/content-items/:contentItemId/scorm/import` handler in the same file — `requirePermission("course.manage")`; `404` if `contentItemId` doesn't resolve in the caller's tenant; `409` if `storageKey` doesn't exist in R2 (`storage.headObject`) or if any existing SCO for this content item has already been launched (a `learner_content_progress` row exists for any of its `scorm_package_items` content item ids); downloads the object (`storage.getObjectStream`, buffered), calls `package-importer.ts` (T018), returning `422` on its error result; on success, deletes the raw uploaded zip (`storage.deleteObject`), responds `201` with `{ packageId, scos }` (contracts §POST import) (depends on T013, T018, T019)
- [x] T021 [US1] Register `tenantScormUploadRoutes` in `apps/api/src/server.ts` (depends on T019, T020)
- [x] T022 [P] [US1] Integration test `apps/api/tests/integration/scorm-package-import.test.ts` — using `build-test-scorm-package.ts` (T015) and `RecordingStorageClient` (T014): a single-SCO package import (no additional content items created, content updated in place), a two-SCO package import (one additional content item created, positioned immediately after, both grouped under one `scorm_packages` row), a malformed-archive rejection (`422`, nothing created), a manifest-with-unresolvable-resource rejection (`422`, nothing created), cross-tenant/nonexistent `contentItemId` → `404`, and forbidden (`403`) for a `course.view`-only caller on both upload-url and import (spec US1 Acceptance Scenarios) (depends on T021)

**Checkpoint**: User Story 1 is fully functional and independently testable — packages can be uploaded
and imported, creating the right content items.

---

## Phase 4: User Story 2 - Launch and play a SCORM package as a learner (Priority: P1)

**Goal**: A learner opens an imported SCO's launcher page, which loads the SCO in an iframe and exposes a
real SCORM 1.2 RTE API object the SCO's own JS can discover and call.

**Independent Test**: As a learner, request launch data for an imported SCO and confirm it includes a
resolvable entry-point URL and CMI seed data; load the launcher page in a browser and confirm the SCO
loads and can locate `window.API` via the parent-chain search.

### Implementation for User Story 2

- [x] T023 [US2] Add `GET /tenant/content-items/:contentItemId/scorm/launch` handler in `apps/api/src/scorm/tenant-scorm-runtime-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; `404` if `contentItemId` doesn't resolve in the caller's tenant or has no `scorm_package_items` row; gathers the caller's `learner_content_progress` row (or synthetic not-started default, reusing spec 026's own helper) plus `scorm_cmi_objectives`/`scorm_cmi_interactions` rows, the SCO's own `entryPointRelativePath`/`packageId`, every sibling `scorm_package_items` row sharing the same `packageId` (ordered by `position`) each joined to its own `learner_content_progress.status` for the `navigation.scos[].status` field, and computes `navigation.packageStatus` (spec FR-014 — `"completed"` iff every sibling's status is `completed`/`passed`, else `"in_progress"` if any is touched, else `"not_started"`); responds `200` per contracts §GET launch, with `cmi.entry` set to `"resume"` iff a progress row already exists (depends on T009)
- [x] T024 [US2] Add `GET /tenant/scorm/packages/:packageId/files/*` handler in the same file — `requireAnyPermission("course.view", "course.manage")`; `404` if `packageId` doesn't resolve in the caller's tenant; computes the storage key `{tenantId}/scorm/{packageId}/{wildcardPath}` and streams via `storage.getObjectStream` (T013), `404` if the object doesn't exist; sets `Content-Type` from a small file-extension→MIME lookup table (html/js/css/png/jpg/jpeg/gif/svg/json/xml/mp4/mp3/woff/woff2, default `application/octet-stream`) (contracts §GET files) (depends on T013)
- [x] T025 [US2] Register `tenantScormRuntimeRoutes` in `apps/api/src/server.ts` (depends on T023, T024)
- [x] T026 [P] [US2] Implement `apps/web/lib/scorm-cmi-error-codes.ts` — exported constants for all 11 SCORM 1.2 error codes (contracts §Error Codes table) with their canonical `LMSGetErrorString` messages
- [x] T027 [US2] Implement `apps/web/lib/scorm-rte-api.ts` — `createScormApi(launchData, contentItemId): ScormApi` building the `window.API` object: an in-memory CMI model seeded from `launchData.cmi`/`launchData.studentId`/`launchData.studentName`; `LMSInitialize`/`LMSGetValue`/`LMSSetValue`/`LMSGetLastError`/`LMSGetErrorString`/`LMSGetDiagnostic` implemented as pure synchronous in-memory operations enforcing the RTE state machine (uninitialized/active/terminated) and returning the correct error code (T026) for out-of-sequence calls, read-only-element writes (`cmi.core.student_id`/`student_name`/`credit`/`entry`/`total_time`), and unrecognized element names (depends on T026)
- [x] T028 [US2] Implement `apps/web/app/(dashboard-shell)/learning/scorm/[contentItemId]/page.tsx` (Server Component) — `getTenantSession` check (redirect/deny if unauthenticated or lacking `course.view`/`course.manage`, mirrors the existing `training-requests` page's own session-check pattern), fetches launch data server-to-server, renders `scorm-launcher-client.tsx` with the launch data as props (depends on T023)
- [x] T029 [US2] Implement `apps/web/app/(dashboard-shell)/learning/scorm/[contentItemId]/scorm-launcher-client.tsx` (Client Component) — renders an iframe whose `src` is `launchData.entryPointUrl` (a relative `/tenant-api/...` path, never `API_ORIGIN` directly — research.md §10); on mount, calls `createScormApi` (T027) and assigns the result to `window.API` on this component's own window (the iframe's parent) so the SCO can discover it via the standard search algorithm (depends on T027, T028)
- [x] T030 [P] [US2] Integration test `apps/api/tests/integration/scorm-launch-and-runtime.test.ts` — covers launch data for an untouched SCO (`cmi.entry: "ab-initio"`, empty objectives/interactions), the file-proxy route serving the entry point and a relative asset with correct `Content-Type`, a nonexistent relative path → `404`, cross-tenant/nonexistent `contentItemId`/`packageId` → `404`, and forbidden (`403`) for a caller holding neither `course.view` nor `course.manage` on both launch and file-proxy (spec US2 Acceptance Scenarios) (depends on T025)

**Checkpoint**: User Stories 1 AND 2 both work independently — a package can be imported and its
launcher page loads with a discoverable RTE API object.

---

## Phase 5: User Story 3 - Persist and resume runtime state across sessions (Priority: P1)

**Goal**: `LMSCommit`/`LMSFinish` durably persist the in-memory CMI model via a synchronous XHR, and a
later relaunch resumes from that saved state.

**Independent Test**: Commit a bookmark/suspend-data/score via the cmi endpoint, then request launch
data again and confirm every value round-trips with `cmi.entry: "resume"`.

### Implementation for User Story 3

- [x] T031 [US3] Add `PUT /tenant/content-items/:contentItemId/scorm/cmi` handler in `apps/api/src/scorm/tenant-scorm-runtime-routes.ts` — `requireAnyPermission("course.view", "course.manage")`; `404` if `contentItemId` doesn't resolve in the caller's tenant or has no `scorm_package_items` row; `400` if `suspendData` exceeds 4096 characters (reuses `progress-validation.ts`'s check, spec 026); in one transaction: upserts `learner_content_progress` exactly per spec 026's own upsert logic (status/score/bookmark/suspendData/accumulated `totalTimeSeconds`), then deletes and bulk-re-inserts the caller's `scorm_cmi_objectives`/`scorm_cmi_interactions` rows for this content item from the submitted arrays; responds `200` (contracts §PUT cmi) (depends on T009)
- [x] T032 [US3] Extend `apps/web/lib/scorm-rte-api.ts` (T027) — implement `LMSCommit`/`LMSFinish` as synchronous `XMLHttpRequest` (`async: false`) calls to `PUT /tenant-api/tenant/content-items/:contentItemId/scorm/cmi` with the accumulated in-memory CMI model (research.md §6); a non-`200` response sets error code `101` and the function returns `"false"`; a `200` response returns `"true"` (depends on T027)
- [x] T033 [P] [US3] Integration test `apps/api/tests/integration/scorm-launch-and-runtime.test.ts` (same file as T030 — combined per plan.md's US2+US3 test-file grouping) — additionally covers a commit then a fresh launch-data request showing `cmi.entry: "resume"` with every field (bookmark, suspendData, score, objectives, interactions) round-tripped, an over-length-`suspendData` rejection (`400`, no partial write), and objectives/interactions arrays fully replaced (not appended) on a second commit (spec US3 Acceptance Scenarios) (depends on T031)

**Checkpoint**: User Stories 1, 2, AND 3 all work independently — the full import → launch → play →
resume loop works end-to-end.

---

## Phase 6: User Story 4 - Navigate between multiple SCOs in a package (Priority: P2)

**Goal**: A learner moves between sibling SCOs in a multi-SCO package via always-unlocked previous/next
navigation, and the package's overall completion status rolls up per FR-014.

**Independent Test**: Import a two-SCO package, launch each in turn via the navigation data already
returned by the launch endpoint, confirm neither is ever locked, complete both, and confirm
`navigation.packageStatus` becomes `"completed"` only once both are.

### Implementation for User Story 4

- [x] T034 [US4] Add previous/next navigation controls to `apps/web/app/(dashboard-shell)/learning/scorm/[contentItemId]/scorm-launcher-client.tsx` (T029) — renders `launchData.navigation.scos` as always-clickable links (never disabled/locked by another SCO's `status`) that navigate to `/learning/scorm/{contentItemId}` for the target SCO, highlighting the current position (depends on T029)
- [x] T035 [P] [US4] Integration test `apps/api/tests/integration/scorm-multi-sco-navigation.test.ts` — imports a three-SCO package and covers: launch data for any of the three SCOs includes all three in `navigation.scos`, correctly ordered by `position`; `navigation.packageStatus` is `"not_started"` initially, `"in_progress"` once any one SCO is committed as `completed`, and `"completed"` only once all three are (spec US4 Acceptance Scenarios, FR-014) (depends on T023, T031)

**Checkpoint**: All four user stories are independently functional — the full spec scope is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification work that spans or sits outside individual user stories.

- [x] T036 [P] Validate quickstart.md's eight scenarios: Scenarios 1-2 (import, malformed rejection) are covered by T022; Scenario 3 (launch + resume) by T030/T033; Scenario 4 (over-length suspend data) by T033; Scenario 5 (file proxy) by T030; Scenario 6 (multi-SCO import + navigation) by T022/T035; Scenario 7 (real-browser RTE API discovery) is the one scenario in this entire spec sequence requiring manual verification — Vitest's integration tests exercise the API layer, not a real browser's `window`/iframe chain, so this MUST be manually checked in a real browser before considering this spec demo-ready, not silently skipped; Scenario 8 (tenant isolation/permission gating) is covered by the `404`/`403` cases already present in T022/T030/T035 (depends on T022, T030, T033, T035)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — already complete (T001).
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion.
  - US1 (Phase 3) has no dependency on any other story.
  - US2 (Phase 4) depends on Foundational only for its own handlers (T023-T029); its own integration
    test (T030) needs US1 (T021) to have an imported package to launch.
  - US3 (Phase 5) depends on Foundational only for its own handler (T031); its integration test (T033,
    combined into T030's file) needs US1 and US2 to have a launchable SCO with launch data to compare
    against.
  - US4 (Phase 6) depends on US2's launch handler (T023, for `navigation`/`packageStatus`) and US3's cmi
    handler (T031, to actually complete SCOs for the rollup test); its own UI task (T034) depends on
    US2's client component (T029) already existing.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Within Each User Story

- Route handlers before their integration test.
- Backend routes before the `apps/web` components that call them (US2/US3).
- Story complete before moving to the next priority (or in parallel, per staffing).

### Parallel Opportunities

- T004-T007 (the four RLS migrations) are independent of each other — all depend only on T003.
- T011 and T015 (interface extension, test-fixture builder) are independent of each other and of the
  migration chain — all depend only on T010 where relevant.
- T014 (RecordingStorageClient extension) and T016/T017 (manifest parser + its unit test) are
  independent of T012/T013 (real R2 implementation) — only need the interface (T011).
- T022, T030, T033, T035, T036 (all `[P]`-marked test tasks) can run in parallel with each other once
  their respective implementation tasks land.
- T026 (error-code constants) has no backend dependency and can be built in parallel with any backend
  task once Foundational is done.

---

## Parallel Example: Foundational Phase

```bash
# Once T003 (schema migration) and T010 (dependencies installed) land, these can proceed in parallel:
Task: "Add the four RLS migrations (0086-0089)"
Task: "Extend StorageClient interface + RecordingStorageClient fixture"
Task: "Implement build-test-scorm-package.ts fixture builder"
Task: "Implement manifest-parser.ts + its unit test"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (already done).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories, and is unusually large for this spec:
   4 tables, an extended storage primitive, and the manifest parser all live here).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run T022 independently (single-SCO and multi-SCO import both create the right
   content items).
5. An imported package nobody can play is unverifiable in practice — User Story 2 (launch) is the
   natural next increment, and the first point this spec sequence produces anything demoable.

### Incremental Delivery

1. Complete Setup + Foundational → foundation ready (tables, storage primitive, manifest parser).
2. Add User Story 1 → test independently (import, single- and multi-SCO).
3. Add User Story 2 → test independently (launch data, file proxy, real-browser RTE discovery) — this is
   the first point in the entire three-spec sequence (025/026/027) with a genuinely demoable UI.
4. Add User Story 3 → test independently (commit + resume) → this is the first point a SCORM course is
   actually usable end-to-end (play it, leave, come back, resume).
5. Add User Story 4 → test independently (multi-SCO navigation + completion rollup).
6. Phase 7 polish → full spec scope verified via automated tests, plus the one unavoidable manual
   real-browser check (Scenario 7).

### Parallel Team Strategy

With multiple developers: all complete Setup + Foundational together (including the storage extension
and manifest parser, since every story depends on both). Once Foundational lands, US1's backend work and
US2's backend route work can proceed in parallel (US2's launch/file-proxy handlers don't need US1's
import logic to exist to be *written*, only to be *tested against real data*) — `apps/web` work (US2/US4)
can start once the corresponding `apps/api` contracts are stable, even before those routes' own
implementation lands, since the frontend only needs the JSON shape, not working data, to build against.

---

## Notes

- `[P]` tasks = different files, or same file with non-overlapping handlers and no completion-order
  dependency.
- `[Story]` label maps task to specific user story for traceability.
- Every user story is independently completable and testable against its own (or a shared,
  explicitly-noted) integration test file.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
- This is the first spec in the 025→026→027 sequence to modify previously-shipped code
  (`StorageClient`/`R2StorageClient`/`RecordingStorageClient`, spec 025) rather than being purely
  additive — T011-T014 touch those existing files directly.
- Scenario 7 of quickstart.md (real-browser RTE API discovery) has no automated-test substitute anywhere
  in this task list — it is the one piece of this entire three-spec sequence that must be manually
  verified before the feature can be called done, and T036 explicitly calls this out rather than letting
  it be silently skipped.
