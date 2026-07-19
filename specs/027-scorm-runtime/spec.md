# Feature Specification: SCORM 1.2 Runtime

**Feature Branch**: `027-scorm-runtime`

**Created**: 2026-07-19

**Status**: Draft

**Input**: User description: "SCORM 1.2 Runtime — real SCORM package import, hosting, and playback for the TM multi-tenant SaaS, specializing the external_import content type from the Course Content spec (024) when its sourceType is "scorm". Depends on two prerequisite specs that must exist first: a File Upload & Storage spec (Cloudflare R2, S3-compatible object storage — a new dependency requiring explicit sign-off per Constitution Principle XIII) and a Learner Progress / Attempt Tracking spec (a per-learner, per-content-item attempt/session entity — nothing in the schema today represents a learner being enrolled in or progressing through a course). This spec assumes both already exist and builds the SCORM-specific runtime on top of them. Scope: accept an uploaded SCORM 1.2 .zip package for an external_import content item; parse imsmanifest.xml to extract the <organizations>/<item> tree and resolve each item's <resource> to its entry-point file; extract and host every package file in R2 under a package-scoped path, preserving relative paths; provide a minimal browser-rendered launcher page (the one necessary UI surface — SCORM's Run-Time Environment is a JavaScript object contract, not an HTTP contract, so a pure API-only spec is not possible here) that embeds the SCO in an iframe and exposes a real API object implementing LMSInitialize, LMSGetValue, LMSSetValue, LMSCommit, LMSFinish, LMSGetLastError, LMSGetErrorString, LMSGetDiagnostic per the SCORM 1.2 RTE spec, including the standard API-discovery algorithm (SCO searches up the window/parent/opener chain). Persist the full CMI 1.2 data model per learner per attempt (via the Learner Progress spec's attempt entity): cmi.core.lesson_status, cmi.core.score.raw/min/max, cmi.core.lesson_location (bookmark), cmi.core.session_time/total_time, cmi.core.entry/exit, cmi.suspend_data (4096-char cap), cmi.core.student_id/student_name (from the authenticated learner's session), cmi.objectives.n.*, cmi.interactions.n.*, cmi.student_preference.*, with spec-accurate error codes (0/101/201/202/203/301/401/402/403/404/405) since conformance test suites check these exactly. Navigation between multiple SCOs in a package is simple linear (previous/next) or an always-unlocked menu — SCORM 1.2 defines no sequencing spec, so this is an LMS implementation choice, not a standards requirement. Course/content-item-level completion status should roll up from SCO-level cmi.core.lesson_status. Explicitly out of scope, and MUST be documented as flagged future work rather than silently implied as already possible: SCORM 2004 (any edition) and its full Sequencing & Navigation state machine (IMS Simple Sequencing — rollup rules, limit conditions, pre/post-condition rules, navigation requests); xAPI and cmi5 entirely, including any LRS integration; SCORM content authoring/editing; package re-versioning after first launch. Permissions: uploading/attaching a package to a content item requires course.manage (same as any other content-item edit); launching and recording runtime data is a learner-facing action gated by whatever session/identity concept the Learner Progress spec establishes, not course.view/course.manage."

## Clarifications

### Session 2026-07-19

- Q: A SCORM package can contain multiple SCOs, but the Learner Progress spec's entity (026) is keyed
  one row per (learner, content item) — how should a multi-SCO package map onto that? → A: Each SCO
  becomes its own content item. Package import creates one content item per SCO in the manifest's
  `<organizations>` tree, all inside the same module as the original upload target; the content item the
  package was originally uploaded to represents the manifest's first SCO, and additional content items
  are auto-created (positioned immediately after it) for every further SCO. Each is independently tracked
  via the existing per-content-item Learner Progress row — no new progress-tracking mechanism is needed.
- Q: How should `cmi.objectives.n.*` and `cmi.interactions.n.*` be persisted, since the Learner Progress
  entity has no columns for these dynamically-indexed arrays? → A: New dedicated tables
  (`scorm_cmi_objectives`, `scorm_cmi_interactions`), fully structured with real columns, one row per
  array index per (learner, content item) — matching the constitution's comprehensive-version-by-default
  principle given conformance-test accuracy is an explicit requirement of this spec.
- Q: What rollup rule determines a multi-SCO package's overall completion status, since SCORM 1.2 defines
  no sequencing rules of its own? → A: All SCOs must complete. The package (identified by the shared
  `SCORM Package` grouping, not the module as a whole, since a module may contain non-package content
  items too) is considered complete only once every one of its constituent content items' own
  `cmi.core.lesson_status` is `completed` or `passed`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import a SCORM package into a content item (Priority: P1)

An L&D admin holding `course.manage` uploads a SCORM 1.2 `.zip` package to an `external_import` content
item whose `sourceType` is `"scorm"`. The system extracts and hosts the package, parses its manifest,
and — per the Clarifications above — makes every SCO in it available as its own content item, all
grouped under one `SCORM Package` record.

**Why this priority**: Nothing else in this spec is reachable without a successfully imported package —
this is the foundational capability the rest of the spec builds on.

**Independent Test**: As a user holding `course.manage`, upload a small, valid SCORM 1.2 package to a
`scorm`-sourced content item and confirm the system creates one content item per SCO in the manifest once
processing completes.

**Acceptance Scenarios**:

1. **Given** a valid SCORM 1.2 `.zip` package with a single `<organization>` containing exactly one
   `<item>` resolving to a real `<resource>` entry point, **When** an admin holding `course.manage`
   uploads and confirms it against a `scorm`-sourced content item, **Then** the package's files are
   extracted and hosted, its manifest is parsed, and the uploaded-to content item itself becomes that
   SCO's launchable unit — no additional content items are created.
2. **Given** a valid SCORM 1.2 `.zip` package whose manifest contains more than one launchable `<item>`,
   **When** an admin uploads and confirms it against a `scorm`-sourced content item, **Then** the
   uploaded-to content item becomes the manifest's first SCO, one additional content item is created
   (positioned immediately after it in the same module) for each further SCO, and all resulting content
   items are grouped under a single `SCORM Package` record.
3. **Given** a `.zip` that is not a valid archive, or lacks an `imsmanifest.xml` at its root, **When**
   upload/processing is attempted, **Then** it is rejected and the content item's package state is left
   unset — no additional content items are created.
4. **Given** a manifest whose `<organizations>/<item>` tree references a `<resource>` with no matching
   entry-point file inside the archive, **When** processing is attempted, **Then** it is rejected with a
   clear reason, and no content items are created or modified.
5. **Given** a user holding only `course.view` (not `course.manage`), **When** they attempt to upload a
   package, **Then** the request is rejected as forbidden.

---

### User Story 2 - Launch and play a SCORM package as a learner (Priority: P1)

A learner opens a `scorm`-sourced content item they can already view (per the Learner Progress spec's
`course.view`-gated write access) and is taken to a launcher page that runs the packaged content inside
an iframe, backed by a real SCORM 1.2 RTE API object the content calls into.

**Why this priority**: This is the entire reason a SCORM runtime exists — playing real, unmodified
third-party SCORM content, not just storing it.

**Independent Test**: As a learner, launch an imported package's SCO and confirm the launcher page
successfully discovers the RTE API object and the SCO's own `LMSInitialize()` call succeeds.

**Acceptance Scenarios**:

1. **Given** an imported, launchable SCO, **When** a learner opens its launcher page, **Then** the SCO
   loads in an iframe and can locate the RTE API object via the standard window/parent/opener
   API-discovery algorithm.
2. **Given** a loaded SCO, **When** it calls `LMSInitialize("")`, **Then** the call succeeds (`"true"`)
   exactly once per launch session; a second `LMSInitialize` call before `LMSFinish` fails with the
   correct SCORM 1.2 error code.
3. **Given** an active session, **When** the SCO calls `LMSGetValue("cmi.core.student_id")` or
   `LMSGetValue("cmi.core.student_name")`, **Then** the authenticated learner's own id/name is returned,
   never a client-suppliable value.
4. **Given** a learner who lacks the access the Learner Progress spec requires to record progress on
   that content item, **When** they attempt to open the launcher page, **Then** they are denied.

---

### User Story 3 - Persist and resume runtime state across sessions (Priority: P1)

A learner exits a SCORM SCO mid-session (closes the tab, navigates away) and later relaunches it,
resuming from where they left off — bookmark, suspend data, and score all intact.

**Why this priority**: SCORM content is expected to be resumable; a runtime that discards state on every
relaunch fails the basic purpose of tracking a learner's progress through packaged content.

**Independent Test**: Launch a SCO, set a bookmark and some suspend data via `LMSSetValue`, call
`LMSCommit` and `LMSFinish`, relaunch the same SCO, and confirm `LMSGetValue("cmi.core.lesson_location")`
and `LMSGetValue("cmi.suspend_data")` return the previously saved values, and `cmi.core.entry` reports
`"resume"` rather than `"ab-initio"`.

**Acceptance Scenarios**:

1. **Given** a SCO that calls `LMSSetValue` for `cmi.core.lesson_location`, `cmi.suspend_data`,
   `cmi.core.lesson_status`, and `cmi.core.score.raw/min/max`, **When** it calls `LMSCommit` followed by
   `LMSFinish`, **Then** every set value is durably persisted against that learner's own record for that
   content item.
2. **Given** a previously-finished session with saved state, **When** the learner relaunches the same
   SCO, **Then** `LMSGetValue` returns the previously saved bookmark, suspend data, and score, and
   `cmi.core.entry` reports `"resume"`.
3. **Given** a `suspend_data` value the SCO attempts to set beyond 4096 characters, **When**
   `LMSSetValue` is called, **Then** it fails with the correct SCORM 1.2 error code and the previously
   stored value is left unchanged.
4. **Given** a SCO calling `LMSGetValue`/`LMSSetValue` for an unsupported or malformed CMI element name,
   **When** the call is made, **Then** it fails with the correct SCORM 1.2 error code (`401`) rather than
   silently succeeding or crashing the runtime.

---

### User Story 4 - Navigate between multiple SCOs in a package (Priority: P2)

A learner working through a package containing more than one launchable SCO — each its own content item,
per the Clarifications above — moves between them via a simple previous/next control or an
always-unlocked menu, since SCORM 1.2 defines no sequencing rules of its own.

**Why this priority**: Most real-world SCORM 1.2 content is single-SCO, so this extends the runtime to
the (less common but real) multi-SCO case; the platform is still useful without it in the short term.

**Independent Test**: Import a package containing two SCOs, launch the first, complete it, and confirm
the learner can navigate to the second via the provided control, with no lock/gate blocking access to
either.

**Acceptance Scenarios**:

1. **Given** a package with multiple SCOs (multiple sibling content items sharing one `SCORM Package`
   record), **When** a learner is viewing one, **Then** previous/next (or an equivalent menu) navigation
   to any other SCO in the same package is always available — never locked by another SCO's completion
   state.
2. **Given** every SCO (content item) in a multi-SCO package, **When** each individually reaches
   `completed`/`passed`, **Then** the package's overall status rolls up to complete, per the "all SCOs
   must complete" rule (FR-014).

---

### Edge Cases

- What happens when a learner's browser session expires mid-SCO-session (between `LMSInitialize` and
  `LMSFinish`)? The next `LMSGetValue`/`LMSSetValue`/`LMSCommit` call fails as unauthenticated; any state
  already committed via a prior successful `LMSCommit` is retained, but state set only in-memory since
  the last commit is lost — matches ordinary session-expiry behavior elsewhere in this codebase.
- What happens when the same learner opens the same SCO in two browser tabs simultaneously? Each tab
  gets its own RTE API object instance; the last `LMSCommit`/`LMSFinish` to reach the server wins
  (last-write-wins), consistent with the Learner Progress spec's own concurrency assumption.
- What happens when an admin re-uploads a new package to a content item that a learner has already
  launched? Rejected — package re-versioning after first launch is explicitly out of scope (see
  Assumptions); re-uploading before any learner has launched the package is allowed.
- What happens when a SCO never calls `LMSFinish` at all (abandoned session)? The session is left
  without a formal "exit" value recorded; any state from the last successful `LMSCommit` still persists.
- What happens when `LMSGetValue`/`LMSSetValue` is called before `LMSInitialize`, or after `LMSFinish`?
  Fails with the correct SCORM 1.2 error code (`301`) — the RTE API enforces its state machine, not just
  the individual data-model calls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a SCORM 1.2 `.zip` package upload for a content item whose type is
  `external_import` and whose `sourceType` is `"scorm"`, gated by `course.manage` (reusing spec 024's
  existing permission — no new permission key).
- **FR-002**: System MUST parse the package's `imsmanifest.xml`, extracting its `<organizations>/<item>`
  tree and resolving each item's `<resource>` to a real entry-point file inside the archive; a package
  failing to parse, or referencing a resource with no matching file, MUST be rejected before any content
  is made available to learners.
- **FR-003**: System MUST create one content item per launchable SCO found in the manifest, all within
  the same module as the content item the package was originally uploaded to: the uploaded-to content
  item itself becomes the manifest's first SCO, and one additional content item is auto-created
  (positioned immediately after it) for every further SCO. All resulting content items MUST be grouped
  under a single `SCORM Package` record (spec Clarifications).
- **FR-004**: System MUST extract and host every file in a successfully validated package (not just the
  entry points), preserving the package's internal relative-path structure, so that entry-point HTML
  files' own relative links to other package assets (images, scripts, other pages) resolve correctly.
- **FR-005**: System MUST provide a learner-facing launcher page per SCO (content item) that embeds it in
  an iframe and exposes a SCORM 1.2 RTE API object discoverable via the standard window/parent/opener
  search algorithm.
- **FR-006**: System MUST implement all eight SCORM 1.2 RTE API functions — `LMSInitialize`,
  `LMSGetValue`, `LMSSetValue`, `LMSCommit`, `LMSFinish`, `LMSGetLastError`, `LMSGetErrorString`,
  `LMSGetDiagnostic` — enforcing the RTE's own session state machine (calls outside a valid
  Initialize/Finish window fail with the correct error code, FR-009).
- **FR-007**: System MUST persist, per learner per SCO (i.e. per learner per content item, reusing the
  Learner Progress spec's existing entity directly — spec Clarifications), at minimum:
  `cmi.core.lesson_status`, `cmi.core.score.raw`/`min`/`max`, `cmi.core.lesson_location`,
  `cmi.core.session_time`/`total_time`, `cmi.core.entry`/`exit`, and `cmi.suspend_data` (capped at 4096
  characters).
- **FR-008**: System MUST persist `cmi.objectives.n.*` and `cmi.interactions.n.*` in new, fully
  structured, per-learner-per-content-item tables (not embedded in `suspend_data`), since spec-accurate
  values for these are required by SCORM conformance test suites (spec Clarifications).
- **FR-009**: System MUST return spec-accurate SCORM 1.2 error codes (`0`, `101`, `201`, `202`, `203`,
  `301`, `401`, `402`, `403`, `404`, `405`) for every RTE API call, retrievable via `LMSGetLastError`/
  `LMSGetErrorString`/`LMSGetDiagnostic`, matching the SCORM 1.2 RTE specification exactly.
- **FR-010**: System MUST source `cmi.core.student_id` and `cmi.core.student_name` from the
  authenticated learner's own session — never from a client-suppliable value in any RTE API call.
- **FR-011**: System MUST allow a learner to resume a previously-exited SCO from its last committed
  state (bookmark, suspend data, score, status), reporting `cmi.core.entry` as `"resume"` rather than
  `"ab-initio"` on a relaunch.
- **FR-012**: System MUST gate launching a SCO and recording its runtime data by the same access the
  Learner Progress spec requires to record progress on that content item (`course.view`), not by
  `course.manage` — launching/playing is a learner-facing action, not a course-management action.
- **FR-013**: System MUST provide previous/next (or equivalent always-unlocked menu) navigation between
  every SCO (content item) sharing the same `SCORM Package` record — no SCO's availability MUST ever be
  gated by another SCO's completion state (SCORM 1.2 defines no sequencing rules of its own).
- **FR-014**: System MUST compute a `SCORM Package`'s overall completion status as complete only once
  every one of its constituent content items' own `cmi.core.lesson_status` is `completed` or `passed`
  (spec Clarifications — "all SCOs must complete").
- **FR-015**: System MUST reject an attempt to upload a replacement package to a content item that any
  learner has already launched — package re-versioning after first launch is out of scope (FR-018);
  replacing content means creating a new content item instead.
- **FR-016**: System MUST NOT implement SCORM 2004 (any edition) or its Sequencing & Navigation state
  machine (IMS Simple Sequencing — rollup rules, limit conditions, pre/post-condition rules, navigation
  requests) in this feature — explicitly deferred future work.
- **FR-017**: System MUST NOT implement xAPI or cmi5, including any Learning Record Store integration,
  in this feature — explicitly deferred future work.
- **FR-018**: System MUST NOT support re-versioning an already-launched package, and MUST NOT provide any
  SCORM content authoring/editing capability — explicitly deferred future work; a package is uploaded
  as-is and played as-is.

### Key Entities *(include if feature involves data)*

- **SCORM Package**: The extracted, hosted representation of an uploaded `.zip` — its manifest-derived
  organization/item tree, and every hosted package file's storage location (built on spec 025's
  file-storage primitive). Groups together every content item auto-created from its manifest (one per
  SCO, FR-003) — a one-to-many relationship, not one-to-one with a single content item.
- **SCO Runtime Session**: The bounded lifetime of one `LMSInitialize`...`LMSFinish` call sequence for
  one learner and one SCO (content item) — tracks the RTE API's own state machine (uninitialized /
  active / terminated) so out-of-sequence calls can be correctly rejected (FR-006/FR-009). Not itself
  durably persisted beyond what's committed to the learner's CMI record (FR-007/FR-008).
- **CMI Record**: The persisted SCORM 1.2 data model for one learner's progress on one SCO — the core
  fields (FR-007) live directly on the Learner Progress spec's existing per-content-item entity;
  objectives and interactions (FR-008) live in two new dedicated tables, each row keyed to
  (learner, content item, array index).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner can resume a previously-exited SCO with zero loss of previously committed
  bookmark, suspend data, or score, on 100% of resumed sessions in automated testing.
- **SC-002**: 100% of RTE API calls made outside a valid `LMSInitialize`/`LMSFinish` session window are
  rejected with the correct SCORM 1.2 error code, verified by automated test.
- **SC-003**: 100% of package uploads from users lacking `course.manage`, and 100% of SCO launches from
  users lacking the access the Learner Progress spec requires, are rejected, verified by automated test.
- **SC-004**: A malformed or invalid SCORM package (bad archive, missing manifest, unresolvable resource)
  is rejected before any of its content becomes reachable by a learner, on 100% of tested malformed
  inputs.
- **SC-005**: `cmi.core.student_id`/`cmi.core.student_name` returned by the RTE API always match the
  authenticated learner's own identity, on 100% of tested calls, regardless of any client-supplied value.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: No change to the isolation model — every new table introduced by
  this spec follows the existing shared-schema-with-`tenant_id`-scoping pattern (Principle I). Hosted
  package files reuse spec 025's tenant-namespaced R2 storage-key convention.
- **Tenant-configurable vs. fixed platform-wide**: No new permission keys — upload reuses `course.manage`
  (spec 024), launch/play reuses whatever access the Learner Progress spec (026) requires for
  self-service progress recording (`course.view`). SCORM 1.2 error codes and the RTE API contract are
  fixed by the external standard, not tenant-configurable.
- **AI-generation review/approval step**: N/A — this spec hosts and plays third-party-authored SCORM
  content; it generates no AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this spec tracks per-SCO completion/score state, not
  organizational Results/ROI data.
- **Downgrade/cancellation behavior**: N/A in this spec specifically, but flagged: hosted package storage
  consumes the same underlying R2 storage spec 025 already flagged as lacking quota/plan-tier limits;
  that gap is not newly introduced here, only reused.
- **Design system reference**: The SCO launcher page is this spec's one necessary UI surface — a minimal,
  purpose-built page (an iframe host, not a design-system-driven application screen) since it must embed
  third-party content exactly as authored; it does not follow the established internal design system the
  way an admin-facing screen would, and is flagged here as a deliberate, narrow exception for that
  reason.
- **Demoable vs. internal**: Demoable — a real SCORM package can be uploaded and played end-to-end by a
  stakeholder, unlike the API-only prerequisite specs (025/026) this one builds on.

## Assumptions

- Package processing (extraction + manifest parsing) happens as part of confirming an already-uploaded
  `.zip` (reusing spec 025's presigned-upload-then-confirm flow) rather than introducing a second,
  separate upload mechanism specific to SCORM.
- A "launchable SCO" always corresponds to an `<item>` in the manifest's `<organizations>` tree whose
  `<resource>` resolves to a real file inside the package; non-launchable structural-only items (an
  `<item>` with no `<resource>`, used purely for grouping) are supported as organizational nodes but are
  not themselves launchable.
- Package storage reuses spec 025's `StorageClient` abstraction and R2 backend directly — no new storage
  dependency is introduced by this spec.
- No virus/malware scanning of uploaded packages exists in this spec, consistent with spec 025's own
  explicitly deferred scope for that concern.
- No SCORM 2004, xAPI, or cmi5 support of any kind exists in this spec (FR-016/FR-017) — a future spec
  would need to introduce that support separately, not assume it's silently already covered.
