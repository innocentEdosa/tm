# Implementation Plan: SCORM 1.2 Runtime

**Branch**: `027-scorm-runtime` | **Date**: 2026-07-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/027-scorm-runtime/spec.md`

## Summary

Add a real SCORM 1.2 import/host/playback runtime to `apps/api` and (for the first time in this spec
sequence) `apps/web`. Admins upload a `.zip` package (its own purpose-built presigned-upload flow, not
spec 025's `file_attachments` route surface, since import triggers server-side extraction rather than
simple storage); the server extracts it with `adm-zip`, parses `imsmanifest.xml` with
`fast-xml-parser`, and — per spec Clarifications — creates one content item per SCO, all grouped under a
new `scorm_packages` record. Every extracted file is hosted in R2 under a deterministic, package-scoped
key and served back through a new streaming file-proxy route (not a presigned URL, since the SCO's own
relative-path asset links must resolve against that proxy's own URL structure). A new Next.js page hosts
the SCO in an iframe and injects a real SCORM 1.2 RTE API object (`window.API`) on the parent frame,
backed by a synchronous XHR to a new `PUT .../scorm/cmi` endpoint on `LMSCommit`/`LMSFinish` — reusing
spec 026's `learner_content_progress` row directly for core CMI fields, plus two new tables for
`cmi.objectives.n.*`/`cmi.interactions.n.*` (per Clarifications, chosen for conformance-test accuracy).

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20 (`apps/api`), TypeScript 5.x / React / Next.js
(`apps/web`) — matching every existing module in both apps.

**Primary Dependencies**: Fastify 5, Drizzle ORM 0.45 + drizzle-kit 0.31, existing `request.tenantDb`,
`requirePermission`/`requireAnyPermission`, `requireTenantUserSession` (`apps/api`); Next.js App Router,
`getTenantSession` + the existing `/tenant-api/*` same-origin rewrite (`apps/web`) — all already in
place. Reuses spec 025's `StorageClient`/`storage.ts` (extended, see below) and spec 026's
`learner_content_progress` table directly.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: `adm-zip` (ZIP
archive extraction — Node has no built-in ZIP container parser, only raw gzip/deflate via `zlib`;
`adm-zip`'s synchronous whole-archive-in-memory API is simplest to implement correctly given no
background-job infrastructure exists yet, bounded by a package-size cap, research.md §1) and
`fast-xml-parser` (`imsmanifest.xml` parsing — Node has no built-in XML parser; a lightweight,
zero-dependency, DOM-style parser is sufficient for a manifest file of this size, research.md §2).
**Explicit sign-off was obtained from the user during this planning session** — approved, not assumed.

**Storage**: PostgreSQL (existing shared instance/schema) for four new tables (`scorm_packages`,
`scorm_package_items`, `scorm_cmi_objectives`, `scorm_cmi_interactions`) — see data-model.md. Cloudflare
R2 (via spec 025's existing `StorageClient`, extended with a new `putObject`/`getObjectStream` pair for
server-side extraction writes and proxy reads — research.md §3) for the raw uploaded package and every
extracted file.

**Testing**: Vitest. Integration tests use `RecordingStorageClient` (spec 025) extended with the new
`putObject`/`getObjectStream` methods — no real R2 credentials needed. A fixture SCORM `.zip` (built
in-memory with `adm-zip` inside the test itself, not committed as a binary fixture) exercises the real
extraction/parsing code path without a network dependency.

**Target Platform**: Linux server (existing `apps/api` Fastify deployment, existing `apps/web` Next.js
deployment) — no platform change.

**Project Type**: Web application (existing Next.js + Fastify monorepo). **This is the first spec in
this sequence to touch `apps/web`** — every prior spec (023-026) was `apps/api`-only; this one requires
a real learner-facing UI surface (spec Constitution Alignment: SCORM's RTE is a JS object contract, not
an HTTP contract, so a pure API-only spec is impossible here).

**Performance Goals**: Package import (extraction + manifest parse + per-file upload) happens
synchronously within the confirm/import request — acceptable for typical SCORM package sizes (low tens
of MB) given no background-job infrastructure exists in this codebase yet; flagged as a known scaling
limit for very large packages, not solved by this spec (research.md §5). RTE API calls
(`LMSGetValue`/`LMSSetValue`) are pure in-browser JS against an in-memory model — zero network latency;
only `LMSCommit`/`LMSFinish` hit the network.

**Constraints**: Tenant isolation enforced server-side on every row regardless of client input
(Principle I). The RTE API's calling convention is synchronous (no promises) per the SCORM 1.2 spec
itself — `LMSCommit`/`LMSFinish` MUST use a synchronous `XMLHttpRequest`, the standard real-world
workaround every SCORM player uses (research.md §6). Package uploads are size-capped (500MB) to bound
`adm-zip`'s in-memory extraction cost (research.md §1).

**Scale/Scope**: Two new upload/import routes, one launch-data route, one CMI-commit route, one
wildcard file-proxy route (`apps/api`); one new learner-facing page + RTE API client script
(`apps/web`); four new tables; zero new permission keys (reuses `course.manage`/`course.view`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: PASS. All four new tables carry `tenant_id` directly, RLS
  enabled+forced with the standard hardened policy, identical migration sequence to every prior tenant
  table. The file-proxy route re-derives the storage key from `tenantId` server-side (never trusts a
  client-supplied tenant segment), matching spec 025's storage-key defense-in-depth precedent.
- **Principle II/III (Tenant-configurable, not fixed)**: PASS — no new permission keys; the 500MB
  package-size cap is fixed platform-wide for this spec, not tenant-configurable (matches spec 025's own
  fixed-allowlist precedent).
- **Principle IV (Spec-Before-Code)**: PASS — this plan follows a ratified, `/speckit-clarify`-integrated
  spec (all 3 clarification points resolved directly during `/speckit-specify` for this spec); no
  invented-in-code ambiguity remains.
- **Principle V (Design system)**: PARTIAL, explicitly flagged in spec Constitution Alignment — the SCO
  launcher page is a minimal iframe-host page, not built against the established internal design system,
  since it must embed third-party content exactly as authored. This is a deliberate, narrow exception
  scoped to exactly one page, not a precedent for skipping the design system elsewhere.
- **Principle VI (Plan-tier aware)**: N/A — this spec carries no plan-tier gating of its own.
- **Principle VII (White-labeling)**: N/A — no tenant branding/structural-config surface touched.
- **Principle VIII (Comprehensive-version rule)**: PASS — the objectives/interactions storage decision
  (new dedicated tables over the cheaper suspend-data-embedding alternative) was made explicitly to
  favor the more complete, conformance-accurate option, per this principle.
- **Principle IX (Demoable vs. internal)**: Demoable, stated explicitly in spec Constitution Alignment —
  the first demoable feature in this three-spec sequence (025/026 were both internal/API-only).
- **Principle X (Clean branch)**: PASS — `027-scorm-runtime` branched from `master` after specs 025 and
  026 were both fast-forward-merged in.
- **Principle XI (Fixed stack)**: PASS — Fastify backend + Next.js frontend, no new runtime/framework;
  the RTE API object is plain browser JS served from the existing Next.js app, not a new client
  framework.
- **Principle XII/XIII (No new dependency without justification/sign-off)**: PASS — two new dependencies
  (`adm-zip`, `fast-xml-parser`), both correctly flagged with justification and explicitly approved (see
  Technical Context above) rather than silently added.

No violations. Complexity Tracking table below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/027-scorm-runtime/
├── plan.md                # This file
├── research.md             # Phase 0 output
├── data-model.md           # Phase 1 output
├── quickstart.md           # Phase 1 output
├── contracts/
│   └── scorm-runtime-api.md
└── tasks.md                # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   └── scorm.ts                             # NEW: scormPackages, scormPackageItems,
│   │                                             #      scormCmiObjectives, scormCmiInteractions
│   ├── storage/
│   │   ├── storage-client.ts                    # MODIFIED: + putObject, + getObjectStream
│   │   ├── r2-client.ts                          # MODIFIED: real S3Client PutObject/GetObject-stream impl
│   │   └── storage.ts                            # MODIFIED: + putObject, + getObjectStream wrappers
│   ├── scorm/
│   │   ├── manifest-parser.ts                    # NEW: parses imsmanifest.xml with fast-xml-parser
│   │   ├── package-importer.ts                   # NEW: adm-zip extraction + content-item creation + R2 upload
│   │   ├── tenant-scorm-upload-routes.ts         # NEW: upload-url + import routes (course.manage)
│   │   └── tenant-scorm-runtime-routes.ts        # NEW: launch, cmi-commit, file-proxy routes (course.view)
│   └── server.ts                                 # MODIFIED: register both new scorm route plugins
├── drizzle/
│   ├── NNNN_scorm_tables.sql                     # NEW: schema (drizzle-kit generate)
│   ├── NNNN_rls_scorm_packages.sql               # NEW
│   ├── NNNN_rls_scorm_package_items.sql          # NEW
│   ├── NNNN_rls_scorm_cmi_objectives.sql         # NEW
│   ├── NNNN_rls_scorm_cmi_interactions.sql       # NEW
│   └── NNNN_lock_scorm_grants.sql                # NEW
├── tests/unit/
│   ├── manifest-parser.test.ts                    # NEW
│   └── fixtures/
│       └── build-test-scorm-package.ts            # NEW: constructs an in-memory .zip fixture with adm-zip
└── tests/integration/
    ├── scorm-package-import.test.ts                # NEW (US1)
    ├── scorm-launch-and-runtime.test.ts             # NEW (US2 + US3)
    └── scorm-multi-sco-navigation.test.ts           # NEW (US4)

apps/web/
├── app/(dashboard-shell)/learning/scorm/[contentItemId]/
│   ├── page.tsx                                   # NEW: Server Component, session/permission check
│   └── scorm-launcher-client.tsx                  # NEW: Client Component — iframe host + RTE API object
└── lib/
    ├── scorm-cmi-error-codes.ts                    # NEW: SCORM 1.2 error code constants (client-side only, contracts §Error Codes)
    └── scorm-rte-api.ts                            # NEW: the window.API object implementation (pure client JS)
```

**Structure Decision**: One new `apps/api/src/scorm/` module (route layer, following the
`courses/`/`course-content/`/`attachments/`/`progress/` per-feature-module convention). Two existing
storage files are **modified**, not replaced — `StorageClient`'s interface gains two new methods used
only by this spec, additive to spec 025's existing four. One new `apps/web` route under the existing
`(dashboard-shell)/learning/` group (alongside `training-requests/`), following the existing
Server-Component-session-check + Client-Component-interactivity split already used there. No new
top-level package or project.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
