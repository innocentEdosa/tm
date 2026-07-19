# Research: File Upload & Storage

## 1. New dependency: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`

**Decision**: Add these two npm packages to `apps/api`. **Explicit sign-off obtained from the user
during `/speckit-plan`** (not assumed) per Constitution Principle XIII.

**Rationale**: Cloudflare R2 exposes an S3-compatible API. Presigned URLs require signing requests
with AWS Signature V4 — a well-established, security-sensitive algorithm with no built-in Node/Fastify
equivalent; hand-rolling it would be a security liability for no benefit over the officially maintained
SDK, which already supports pointing at any S3-compatible endpoint (just override the `endpoint` and
`region` config, not just real AWS).

**Alternatives considered**:
- A lighter third-party S3-compatible client — rejected: the official AWS SDK is the de facto standard,
  well-maintained, and this codebase has no existing lightweight-dependency-preference precedent strong
  enough to justify a less-trusted alternative for a security-sensitive signing operation.
- Hand-rolling SigV4 signing — rejected outright, never proposed for sign-off: reimplementing a
  cryptographic signing algorithm by hand is exactly the kind of risk Principle XII exists to avoid.

## 2. Storage abstraction: interface + adapter + test-seam wrapper, mirroring the Mail Sender pattern

**Decision**: `src/storage/storage-client.ts` defines a `StorageClient` interface (`isConfigured()`,
`createPresignedUploadUrl()`, `headObject()`, `createPresignedDownloadUrl()`, `deleteObject()`).
`src/storage/r2-client.ts` provides `R2StorageClient implements StorageClient` (the only real
implementation, using the AWS SDK against R2's endpoint). `src/storage/storage.ts` holds a
module-level `activeClient: StorageClient` plus a `__setStorageClientForTesting()` test-only seam and
the actual functions attachment routes call. `tests/unit/fixtures/recording-storage-client.ts` is an
in-memory fake used by integration tests.

**Rationale**: This is a structurally identical problem to the Email API Mailer spec (016) — a
third-party, network-dependent, credential-gated external service that route handlers need to call, and
that integration tests need to exercise *without* hitting the real provider. That spec already solved
this exact shape with `MailSender`/`ZeptoMailSender`/`mailer.ts`'s `__setMailSenderForTesting()` seam
and `RecordingMailSender` fixture — reusing the identical pattern is a direct continuation of an
already-reviewed, already-working precedent, not a new design.

**Alternatives considered**:
- Mocking the AWS SDK client directly in tests (e.g. `vi.mock("@aws-sdk/client-s3")`) — rejected:
  couples every test to the SDK's own call shape instead of this codebase's own interface, and this
  codebase already has a working, precedent-established alternative that doesn't require that coupling.
- Requiring a real R2 (or MinIO) instance for integration tests — rejected: this codebase's Postgres
  integration tests run against a real local Postgres because Postgres *is* local infrastructure
  (docker-compose); R2 is an external third-party service with real credentials and real cost per call,
  which is exactly the situation the Mail Sender pattern was built to avoid needing for ZeptoMail.

## 3. New table: `file_attachments`, polymorphic like `custom_field_values`

**Decision**: One new table, `entity_type` (text, `CHECK IN ('content_item')` for now) + `entity_id`
(uuid, no database-level FK — deliberately polymorphic). `entity_type`'s `CHECK` constraint is extended
by a future migration the moment a second entity type is wired, exactly like `content_items.type`
(spec 024) already does for its own fixed-but-migration-extensible enum.

**Rationale**: `custom_field_values.entity_id` already establishes the "no FK, caller's own
tenant-scoped fetch is the safety net" polymorphic pattern in this exact codebase (data-model
comment: "the calling module... is responsible for having already confirmed... this id refers to a
real entity in the caller's own tenant"). `file_attachments` needs one thing `custom_field_values`
doesn't — an explicit `entity_type` column — because `custom_field_values` disambiguates "what kind of
entity" indirectly through its own `form_definition_id`, and there is no equivalent form/definition
concept for attachments.

**Alternatives considered**:
- A `content_item_attachments` table scoped only to content items, no polymorphism at all — rejected:
  contradicts the spec's own explicit design goal (a future entity type reuses this without a schema
  change); would need a full second table (and second set of routes/tests) for the very next consumer.

## 4. Routes: new `apps/api/src/attachments/tenant-attachment-routes.ts`, content-item-scoped

**Decision**: One new plugin, five HTTP routes, all requiring the content item they're scoped to
resolve in the caller's tenant first (via `content_items`, spec 024): request an upload URL, confirm
upload, list attachments, get a download URL, delete. A sixth capability — bulk-delete every attachment
for a given entity (spec FR-009) — is exported as a plain function, not an HTTP route, for a future
caller (e.g. a modified content-item delete handler) to invoke directly.

**Rationale**: Matches the one-plugin-per-feature-module convention (`courses/`, `course-content/`).
Content-item-scoping the routes (rather than exposing a fully generic `/tenant/attachments?entityType=
&entityId=` surface) keeps the permission check simple and honest: the route already knows it needs
`course.manage`/`course.view` because it already knows it's about a content item, matching how
`course-content`'s own routes are permission-gated. A fully generic entity-agnostic route would need a
permission-resolver-per-entity-type abstraction for a single consumer — premature given only one entity
type exists.

**Alternatives considered**:
- A fully generic `/tenant/attachments` surface taking `entityType`/`entityId` in the body/query, with a
  pluggable per-entity-type permission resolver — rejected as premature abstraction (this codebase's own
  "no premature abstraction" convention) for exactly one consumer; revisit once a second entity type is
  real, not before.

## 5. Upload/download flow: presigned URLs, size/type verified server-side post-hoc

**Decision**: `POST .../attachments` creates a `pending` `file_attachments` row and returns a presigned
`PutObject` URL (15-minute expiry). The client PUTs directly to R2. `POST
/tenant/attachments/:id/confirm` calls `HeadObject` against R2 to verify the object exists and its
actual size matches what was declared at request time, then flips the row to `ready`. Download issues a
presigned `GetObject` URL (1-hour expiry) for a `ready` attachment; the API never proxies bytes either
direction.

**Rationale**: Directly implements spec FR-002/FR-003/FR-004 — the API server must never receive file
bytes, and a confirmed upload must be independently verified against reality (a lying client claiming
"done" without actually uploading must not produce a `ready` record with wrong metadata).

**Alternatives considered**:
- Enforcing declared `Content-Length` as a signed condition on the presigned PUT URL itself (S3
  supports this) — considered but not required: the post-hoc `HeadObject` verification in FR-004
  already catches a size mismatch after the fact, and enforcing it at signing time adds complexity
  (a wrong client-declared size before upload would need a retry with a fresh URL) for marginal benefit
  over "verify what actually landed."

## 6. Storage key format: tenant-namespaced, human-legible path

**Decision**: `{tenantId}/{entityType}/{entityId}/{attachmentId}/{fileName}` (e.g.
`3f2a.../content_item/9b1c.../a441.../slide-deck.pdf`).

**Rationale**: Application-layer tenant separation inside a single shared bucket (R2 itself has no
tenant concept — spec Constitution Alignment). Including `attachmentId` guarantees uniqueness even if
two attachments on the same entity share a file name; including the readable `entityType`/`entityId`
segments makes the bucket browsable/debuggable by a human operator without a database lookup.

**Alternatives considered**:
- A flat, opaque key (just the attachment id) — rejected: harder to audit/debug in the R2 console, no
  real benefit over the structured path.

## 7. File-type/size allowlist: a small in-code map, not a database table

**Decision**: A plain object literal in the route module, `{ content_item: { contentTypes: [...],
maxSizeBytes: ... } }`, checked before creating the `pending` record. Not tenant-configurable (spec
Constitution Alignment already states this is fixed platform-wide for this spec).

**Rationale**: Simplest possible implementation of a fixed, platform-wide, non-tenant-configurable rule
— no database table, no migration, no admin UI needed for something the spec explicitly says isn't
tenant-configurable yet.

**Alternatives considered**: A database-backed allowlist table — rejected as unnecessary complexity for
a fixed, code-level constant with exactly one entity type today.

## 8. Environment variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`

**Decision**: Four new env vars, following the existing `MAIL_API_TOKEN`/`MAIL_FROM_EMAIL` naming/
placement convention in `.env.example`. R2's S3-compatible endpoint is derived at runtime as
`https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, not stored as its own separate env var (fewer values
to keep in sync). `R2StorageClient.isConfigured()` returns `false` whenever any of the three
credential/bucket values is missing, mirroring `ZeptoMailSender.isConfigured()`'s exact contract — but
unlike mail (where "skip silently, never block the operation" is correct because email is a
best-effort side effect), an unconfigured storage client MUST cause upload requests to fail loudly
(`503`), since without storage there is no fallback path that still delivers the feature's core value.

**Alternatives considered**: None seriously — this follows an established, working convention in the
same codebase.

## 9. Testing: Vitest, `RecordingStorageClient` for integration tests, unit tests for `R2StorageClient`
mirroring `zeptomail-sender.test.ts`

**Decision**: Integration tests (permission gating, tenant isolation, status transitions, allowlist
enforcement) install `RecordingStorageClient` via `__setStorageClientForTesting()`, exactly like
`super-admin-add-member.test.ts` and friends install `RecordingMailSender`. A separate unit test file
exercises `R2StorageClient`'s own request-shaping logic (key construction, expiry values) without a
real network call, mirroring `zeptomail-sender.test.ts`'s treatment of `ZeptoMailSender`.

**Rationale**: Direct continuation of an already-established, working testing convention for exactly
this class of problem (external, credentialed, network-dependent dependency).

**Alternatives considered**: None — established convention.

## 10. No web UI, no route in `apps/web`

**Decision**: This spec adds zero files under `apps/web`, matching specs 023/024's own scope boundary.

**Alternatives considered**: N/A — out of scope by explicit decision during spec scoping.
