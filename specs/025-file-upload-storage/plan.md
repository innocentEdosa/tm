# Implementation Plan: File Upload & Storage

**Branch**: `025-file-upload-storage` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/025-file-upload-storage/spec.md`

## Summary

Add a generic, polymorphic file-attachment capability to `apps/api`, backed by Cloudflare R2
(S3-compatible object storage). One new table (`file_attachments`, `entity_type`/`entity_id` polymorphic
like `custom_field_values`) and five HTTP routes, all scoped to content items (spec 024) as the first
and only wired consumer. Upload and download both happen via presigned URLs the client uses directly
against R2 — the API server never receives file bytes. A `StorageClient` interface + `R2StorageClient`
adapter + test-seam wrapper mirrors the Email API Mailer spec's (016) `MailSender`/`ZeptoMailSender`
pattern exactly, so integration tests never need real R2 credentials. Reuses `course.view`/
`course.manage` — no new permission keys. This is the first of two prerequisite specs (the second is
Learner Progress / Attempt Tracking) that unblock the SCORM 1.2 Runtime spec.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20, matching every existing `apps/api` module.

**Primary Dependencies**: Fastify 5, Drizzle ORM 0.45 + drizzle-kit 0.31, existing `request.tenantDb`,
`requirePermission`/`requireAnyPermission`, `requireTenantUserSession` — all already in place.

**New Dependencies Requiring Justification** *(Constitution Principles XII–XIII)*: `@aws-sdk/client-s3`
and `@aws-sdk/s3-request-presigner` — required to talk to Cloudflare R2's S3-compatible API and sign
presigned URLs (AWS Signature V4), which no built-in Node/Fastify utility can do without hand-rolling a
security-sensitive algorithm (research.md §1). **Explicit sign-off was obtained from the user during
this planning session** — approved, not assumed.

**Storage**: PostgreSQL (existing shared instance/schema) for the `file_attachments` record — one new
table, no change to existing tables. Cloudflare R2 (S3-compatible object storage) for the actual file
bytes — a new external service dependency, credential-gated via four new env vars (research.md §8).

**Testing**: Vitest. Integration tests use `RecordingStorageClient` (research.md §2/§9), mirroring the
Email API Mailer spec's `RecordingMailSender` — no real R2 credentials needed to run the automated
suite. A separate unit test exercises `R2StorageClient`'s own request-shaping logic, mirroring
`zeptomail-sender.test.ts`.

**Target Platform**: Linux server (existing `apps/api` Fastify deployment) — no platform change.

**Project Type**: Web application (existing Next.js + Fastify monorepo). This spec touches only the
backend (`apps/api`) — no frontend changes, matching specs 023/024's own scope pattern.

**Performance Goals**: Not a throughput-sensitive feature — the API's own involvement in an upload/
download is limited to issuing a presigned URL (a fast, local signing operation) and one `HeadObject`
call at confirm time; the actual file transfer happens entirely between the client and R2, off the
API's own request path (SC-001).

**Constraints**: Tenant isolation enforced server-side on every row regardless of client input
(Principle I). The API server MUST NOT receive file bytes at any point (FR-003) — this is a hard
architectural constraint, not a performance nicety.

**Scale/Scope**: Five new HTTP routes plus one internal (non-route) bulk-delete function; one new table;
zero new permission keys; zero frontend routes; content items are the only wired consumer entity type.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Tenant Isolation)**: PASS. `file_attachments` carries `tenant_id` directly, RLS
  enabled+forced with the standard policy, identical migration sequence to every prior tenant table
  (research.md §3). Storage keys are additionally tenant-namespaced at the application layer
  (research.md §6) as defense-in-depth, since R2 itself has no tenant concept.
- **Principle II/III (Tenant-configurable, not fixed)**: PASS — no new permission keys; the file-type/
  size allowlist is fixed platform-wide for this spec (research.md §7), consistent with the spec's own
  stated scope (not tenant-configurable yet).
- **Principle IV (Spec-Before-Code)**: PASS — this plan follows a ratified spec built from an already
  detailed, multi-round-clarified input; no invented-in-code ambiguity remains.
- **Principle V (Design system)**: N/A — no UI in this spec.
- **Principle VI (Plan-tier aware)**: N/A for this spec specifically — storage quotas/plan-tier limits
  are explicitly deferred (spec FR-015); flagged for a future storage-quota spec to address before any
  quota is enforced.
- **Principle VII (White-labeling)**: N/A — no branding/UI surface touched.
- **Principle VIII (Comprehensive-version rule)**: N/A — no scope-narrowing tradeoff arose during this
  spec's own scoping; the generic/polymorphic design was chosen precisely to avoid a narrower,
  single-consumer alternative (research.md §3).
- **Principle IX (Demoable vs. internal)**: Internal/infrastructure-only, stated explicitly in spec
  Constitution Alignment — demoable only via direct API calls (quickstart.md) plus a real R2 bucket,
  until a follow-up UI spec exists.
- **Principle X (Clean branch)**: PASS — `025-file-upload-storage` branched from a clean `master`.
- **Principle XI (Fixed stack)**: PASS — Fastify backend, no new runtime/framework.
- **Principle XII/XIII (No new dependency without justification/sign-off)**: PASS with a real new
  dependency, correctly flagged and explicitly approved (see above) rather than silently added.

No violations. Complexity Tracking table below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/025-file-upload-storage/
├── plan.md              # This file
├── research.md           # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── file-attachment-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   └── file-attachments.ts               # NEW: file_attachments
│   ├── storage/
│   │   ├── storage-client.ts                 # NEW: StorageClient interface
│   │   ├── r2-client.ts                      # NEW: R2StorageClient (real AWS SDK / R2 adapter)
│   │   └── storage.ts                        # NEW: active-client wrapper + test seam (mirrors mailer.ts)
│   ├── attachments/
│   │   ├── attachment-allowlist.ts           # NEW: fixed per-entity-type content-type/size allowlist
│   │   └── tenant-attachment-routes.ts       # NEW: all 5 routes + deleteAllAttachmentsForEntity
│   └── server.ts                             # MODIFIED: register tenantAttachmentRoutes
├── drizzle/
│   ├── NNNN_file_attachments_table.sql        # NEW: schema (drizzle-kit generate)
│   ├── NNNN_rls_file_attachments.sql          # NEW
│   └── NNNN_lock_file_attachments_grants.sql  # NEW
├── tests/unit/
│   ├── r2-client.test.ts                      # NEW: mirrors zeptomail-sender.test.ts
│   └── fixtures/
│       └── recording-storage-client.ts        # NEW: mirrors recording-mail-sender.ts
└── tests/integration/
    ├── attachment-upload-and-confirm.test.ts       # NEW (US1)
    ├── attachment-list-and-download.test.ts        # NEW (US2 + US3)
    └── attachment-delete.test.ts                   # NEW (US4)
```

**Structure Decision**: Two new top-level `apps/api/src/` directories: `storage/` (the provider-agnostic
R2 adapter, following the exact `mail/` + `tenant-auth/mailer.ts` split — a reusable adapter module plus
a thin wrapper that owns the active-implementation/test-seam) and `attachments/` (the route layer,
following the `courses/`/`course-content/` per-feature-module convention). `.env.example` gains the four
new R2 variables, documented the same way `MAIL_API_TOKEN` etc. already are. No `apps/web` changes. No
new top-level package or project — both new directories live inside the existing `apps/api` app.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
