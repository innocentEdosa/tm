# Research: SCORM 1.2 Runtime

## 1. New dependency: `adm-zip`

**Decision**: Add `adm-zip` to `apps/api`. **Explicit sign-off obtained from the user during
`/speckit-plan`** (not assumed) per Constitution Principle XIII.

**Rationale**: Node's standard library has no ZIP container parser (`zlib` only handles raw
gzip/deflate streams, not the ZIP archive format's central directory / local file headers). `adm-zip`'s
synchronous, whole-archive-in-memory API (`new AdmZip(buffer).getEntries()`) is the simplest to
implement correctly given this codebase has no background-job infrastructure yet — extraction happens
inline in the import request. Memory cost is bounded by a 500MB package-size cap (§4).

**Alternatives considered**:
- `unzipper` (streaming) — rejected for v1: avoids buffering the whole archive in memory, better for
  very large packages, but requires more careful async/backpressure handling (entries arrive as a
  stream of events that must each be drained or piped before the next is available) for marginal benefit
  given typical SCORM package sizes (low tens of MB) and the size cap already in place.
- Hand-rolling ZIP parsing — never seriously considered; reimplementing a binary container format is
  exactly the risk Principle XII exists to avoid.

## 2. New dependency: `fast-xml-parser`

**Decision**: Add `fast-xml-parser` to `apps/api`. **Explicit sign-off obtained from the user during
`/speckit-plan`**.

**Rationale**: Node has no built-in XML parser. `imsmanifest.xml` is a small-to-moderate structural
document (an `<organizations>/<item>` tree plus a `<resources>` list) — a lightweight, zero-dependency,
DOM-style parser is sufficient; no streaming/SAX complexity is needed for a file this size.

**Alternatives considered**:
- `xml2js` — rejected: has its own dependency chain (unlike `fast-xml-parser`'s zero-dependency design)
  and a less actively maintained release cadence, for no capability advantage on a file this simple.

## 3. Extending `StorageClient` with server-side `putObject`/`getObjectStream`

**Decision**: Add two methods to the existing `StorageClient` interface (spec 025) — `putObject(key,
body: Buffer, contentType: string): Promise<void>` and `getObjectStream(key): Promise<{ stream:
Readable; contentType?: string } | null>`. `R2StorageClient` implements both with `PutObjectCommand`/
`GetObjectCommand` called directly (not presigned — the server itself is the caller, not delegating to a
client). `RecordingStorageClient` (test fixture) gains an in-memory `Map<string, Buffer>` backing both.

**Rationale**: Every prior use of `StorageClient` (spec 025) was client-direct via presigned URLs — the
API server never touched file bytes. This spec is structurally different: the *server* extracts a ZIP
and must itself write each resulting file to R2, then later stream requested files back out through a
proxy route (§7). No existing method covers either direction. Extending the interface (rather than
building a parallel storage abstraction) keeps exactly one storage seam in this codebase.

**Alternatives considered**:
- A second, SCORM-specific storage interface — rejected: would duplicate `StorageClient`'s
  configured-check/test-seam machinery for no real difference in what's being stored (still R2, still
  the same credentials).

## 4. Upload flow: a purpose-built pipeline, not spec 025's `file_attachments`

**Decision**: SCORM package upload gets its own two-step flow — `POST
.../scorm/upload-url` (presigned PUT for the raw `.zip`, size-capped at 500MB, content-type restricted
to zip MIME types) and `POST .../scorm/import` (downloads the raw zip server-side, extracts with
`adm-zip`, parses the manifest, creates content items, uploads every extracted file via the new
`putObject`, then deletes the raw zip). Neither route touches spec 025's `file_attachments` table.

**Rationale**: `file_attachments`' `confirm` step (spec 025) does a simple `HeadObject`
existence/size check and flips a status flag — it has no concept of "extract and process." Reusing it
would mean either bolting extraction logic onto an unrelated route (violating spec 025's own scope) or
extending its allowlist with a 500MB zip exception that makes no sense for the ordinary
image/PDF-attachment use case it serves. A purpose-built pipeline keeps both specs' scope clean.

**Alternatives considered**:
- Extending `file_attachments`/its allowlist to accept SCORM zips directly, with confirm triggering
  extraction as a side effect — rejected: conflates two different lifecycles (a simple attachment's
  `pending → ready` with no processing step, vs. a package's upload → extract → many-content-items
  outcome) inside one table/route surface.

## 5. Import processing: synchronous within the request, not a background job

**Decision**: Extraction, manifest parsing, and per-file upload all happen inline within the `POST
.../scorm/import` request handler. No job queue is introduced.

**Rationale**: This codebase has no background-job infrastructure (no BullMQ, no worker process)
anywhere yet. Introducing one for this single use case would be a large, premature piece of
infrastructure (Constitution Principle XII's "no premature abstraction" spirit) for what is, at the
500MB cap, a bounded, tens-of-seconds operation in the common case. Flagged as a known scaling limit —
very large packages will produce a long-running request — explicitly not solved here.

**Alternatives considered**:
- Background job processing with a polling/webhook completion signal — rejected for v1: real,
  non-trivial new infrastructure for a problem this spec's size cap already bounds adequately.

## 6. RTE API calling convention: synchronous XHR for `LMSCommit`/`LMSFinish`

**Decision**: The `window.API` object's `LMSCommit`/`LMSFinish` implementations use a synchronous
`XMLHttpRequest` (`xhr.open(method, url, false)`) to call the new `PUT .../scorm/cmi` endpoint, rather
than `fetch`/async code. `LMSGetValue`/`LMSSetValue` operate purely against an in-memory CMI model
(seeded from the launch endpoint's response, mutated locally) with **zero network calls** — they are
synchronous by construction, no XHR needed.

**Rationale**: SCORM 1.2's RTE API predates Promises/async-await entirely — a SCO calls `LMSSetValue(...)`
and expects an immediate string return (`"true"`/`"false"`), not a callback or awaited value. This is
the standard, well-established real-world pattern every SCORM player (SCORM Cloud, Rustici's own
players, etc.) uses; synchronous XHR is deprecated for general web use but remains fully functional and
is the correct tool for this exact legacy calling-convention requirement.

**Alternatives considered**:
- Making `LMSSetValue` itself synchronously hit the network — rejected: SCOs can call `LMSSetValue`
  dozens of times per second (e.g., scrubbing a video's bookmark); network-calling every one would be
  both slow and unnecessary. Batching into memory and syncing once on `Commit`/`Finish` matches both the
  spec's intent and every real implementation.

## 7. Serving package files: a streaming proxy route, not presigned URLs

**Decision**: `GET /tenant/scorm/packages/:packageId/files/*path` streams the requested file directly
from R2 through the API server (`getObjectStream`, §3), computing the storage key deterministically as
`{tenantId}/scorm/{packageId}/{relativePath}` — no per-file database lookup table.

**Rationale**: A SCORM entry-point HTML file makes ordinary relative-path requests for its own assets
(`<img src="images/pic.png">`, `<script src="lib/scorm-api-wrapper.js">`) that the *browser* resolves
against the *current page's own URL*. Object storage's presigned single-object URLs have no mechanism
for that — the SCO's own relative links would all 404. Serving every file through one proxy route whose
own path structure mirrors the package's internal structure makes relative-path resolution work exactly
the way ordinary static web hosting does. This is a deliberate departure from spec 025's "downloads stay
off the API's data path" principle — that principle applies to single opaque file attachments, not to
hosting a mini-website with internal relative links, which fundamentally requires server-side path
resolution.

**Alternatives considered**:
- Rewriting every relative link inside extracted HTML/CSS/JS to point at individually presigned URLs —
  rejected: fragile (presigned URLs expire and would need periodic regeneration), and rewriting
  arbitrary third-party JS/CSS asset references correctly is a much harder, more error-prone problem
  than simply proxying.
- A `scorm_package_files` catalog table (one row per extracted file, storage key + content type) — not
  adopted: the deterministic key derivation makes a catalog unnecessary; content type is derived from
  file extension at proxy-serve time via a small extension→MIME lookup table (no new dependency).

## 8. Multi-SCO data model: `scorm_packages` + `scorm_package_items`, real FKs to `content_items`

**Decision**: `scorm_packages` (one row per import) and `scorm_package_items` (one row per SCO,
`content_item_id` a real FK with `ON DELETE CASCADE`, plus a package-scoped `position` for
previous/next ordering distinct from the module-wide `content_items.position`) — unlike
`file_attachments`/`learner_content_progress`'s deliberately loose (no-FK) coupling to `content_items`.

**Rationale**: `scorm_package_items` rows are created in the *same* import transaction as their
corresponding `content_items` rows, by this spec's own code — not an independently-lifecycled
cross-spec relationship (the reason spec 025/026 avoided a FK). A real FK with `CASCADE` is
correct and safe here: deleting a SCO's content item should also delete its now-meaningless package-item
detail row. A separate `position` field is needed because a module can contain non-package content items
interspersed with a package's SCOs — module-wide position isn't the same ordering as "next SCO in this
specific package."

**Alternatives considered**:
- No FK, mirroring spec 025/026's convention — rejected: that convention exists specifically to survive
  independent lifecycles and future entity types; neither applies here, and a real FK gives free
  referential integrity + cascade cleanup this spec actually wants.

## 9. `cmi.objectives.n.*`/`cmi.interactions.n.*` schema: loosely-validated, conformance-shaped

**Decision**: `scorm_cmi_objectives`/`scorm_cmi_interactions` (data-model.md) store each array element's
fields as plain nullable columns (no `CHECK` constraint on `status`/`result`/`type` sub-values) — only
the top-level array-index uniqueness is enforced structurally.

**Rationale**: SCORM conformance test suites primarily check that values submitted via `LMSSetValue` for
these elements round-trip correctly via `LMSGetValue` — not that this LMS itself re-validates every
SCORM-defined sub-vocabulary. Enforcing strict `CHECK`s here risks silently rejecting a technically
valid-but-uncommon value a real SCO submits, which is worse for conformance than accepting and storing
whatever was set.

**Alternatives considered**:
- Full `CHECK` constraints mirroring every SCORM 1.2-defined enumerated sub-value — rejected as
  over-engineering for v1; the round-trip-accuracy requirement (spec FR-009) doesn't depend on it.

## 10. Frontend: new `apps/web` page, same-origin `/tenant-api/*` proxy

**Decision**: `apps/web/app/(dashboard-shell)/learning/scorm/[contentItemId]/page.tsx` (Server
Component, `getTenantSession` check) renders a Client Component that fetches launch data and issues the
`LMSCommit`/`LMSFinish` XHR against relative `/tenant-api/...` paths — never `API_ORIGIN` directly.

**Rationale**: `next.config.ts`'s existing rewrite (`/tenant-api/:path* → API_ORIGIN`) exists precisely
so the tenant session cookie stays same-origin from the browser's point of view (documented in
`next.config.ts` itself, and in this session's own memory of the equivalent Super Admin cookie
cross-origin issue). A synchronous XHR is just as subject to this as `fetch` — it must also go through
the relative path.

**Alternatives considered**: None seriously — this is an established, working convention already used
by every other tenant-facing page in `apps/web`.

## 11. No package-size or objectives/interactions caps beyond the 500MB upload cap

**Decision**: A single 500MB cap on the raw `.zip` upload (checked via `headObject`'s reported size
before import proceeds) is the only size-related guard this spec introduces. No separate cap on
extracted file count or total uncompressed size.

**Rationale**: The 500MB compressed-size cap already bounds `adm-zip`'s in-memory extraction cost to a
reasonable ceiling for a Node process; a pathological compression-ratio "zip bomb" within that cap is an
edge case not worth its own separate defense mechanism for v1, consistent with spec 025's own choice not
to build virus/malware scanning.

**Alternatives considered**: A separate uncompressed-size/file-count cap — considered, not adopted for
v1; flagged as a candidate hardening measure if abuse is observed in practice.
