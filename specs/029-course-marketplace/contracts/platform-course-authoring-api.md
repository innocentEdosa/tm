# Contract: Platform Course Authoring API (Super Admin)

Routes live in three new plugins — `apps/api/src/platform-courses/platform-course-routes.ts`,
`platform-course-content-routes.ts`, `platform-course-file-routes.ts` — registered in `server.ts`
alongside `adminRoutes`/`provisioningRoutes`. Every route requires `requireSuperAdminSession` and
operates through `fastify.db` (no `tenant_id`, no RLS on these tables — protection is this
preHandler alone). No tenant permission of any kind grants access to any route below.

## `POST /admin/platform-courses`

**Body**: `{ title, description?, categoryName, deliveryMode, duration: { value, unit }, provider?, cost? }`.

**Response** `201`: the created platform course, `status: "draft"`.

**Errors**: `400` missing/invalid field (mirrors spec 023 `courses` validation exactly). `401`/`403` no
valid Super Admin session.

## `PATCH /admin/platform-courses/:id`

**Body**: any subset of the create fields, plus `status` (`draft`/`active`/`archived`, no restricted
transition graph — same as spec 023).

**Errors**: `404` unknown id. `409` if this edit targets an immutable field (title/category/delivery
mode/duration — content, not top-level metadata, is what's frozen per data-model.md's immutability
rule) on a course with ≥1 `fulfilled` selection — see FR-013; metadata-only fields (title, description,
provider, cost, status) remain editable regardless.

## `GET /admin/platform-courses` / `GET /admin/platform-courses/:id`

List supports `search` (title substring), `status`, `category`, `deliveryMode` filters. Detail
includes the module/content-item curriculum outline, same shape as
`course-marketplace-api.md`'s tenant-facing detail response.

---

## `POST /admin/platform-courses/:id/modules`

**Body**: `{ title, description? }`. Append-only — no position field accepted (mirrors spec 024 FR-001).

## `PATCH /admin/platform-course-modules/:id` · `DELETE /admin/platform-course-modules/:id`

Delete cascades to the module's own content items (spec 024 precedent). Both rejected `409` if the
owning platform course has ≥1 `fulfilled` selection.

## `POST /admin/platform-course-modules/:moduleId/content-items`

**Body**: `{ type, title, description?, payload }` — `payload` validated per `type` by the existing
`validateContentItemPayload` (research.md §6), identical rules to spec 024's tenant content items.
Append-only.

## `PATCH /admin/platform-course-content-items/:id` · `DELETE /admin/platform-course-content-items/:id`

Same edit/delete semantics as spec 024's tenant content items (`type` immutable once set). Both
rejected `409` once the owning platform course has ≥1 `fulfilled` selection.

## `PUT /admin/platform-courses/:id/modules/reorder` · `PUT /admin/platform-course-modules/:id/content-items/reorder`

Complete-ordered-id-list reorder, identical contract shape to spec 024's `PUT` reorder endpoints.

---

## `POST /admin/platform-course-content-items/:id/attachments/upload-url`

**Body**: `{ fileName, contentType, sizeBytes }`.

**Response** `201`: `{ attachmentId, uploadUrl }` — presigned PUT URL via the existing `StorageClient`
(spec 025), unchanged allowlist logic, scoped to a platform-namespaced storage key.

**Errors**: `409` if the owning platform course has ≥1 `fulfilled` selection (FR-013 — files are
immutable once cloned).

## `POST /admin/platform-course-content-items/:id/attachments/:attachmentId/confirm`

Verifies the object exists in R2 (`headObject`), marks the `platform_file_attachments` row `ready` —
identical flow to spec 025's tenant confirm endpoint.

## `GET /admin/platform-course-content-items/:id/attachments` · `DELETE /admin/platform-course-content-items/:id/attachments/:attachmentId`

List returns only `ready` attachments. Delete rejected `409` once the owning platform course has ≥1
`fulfilled` selection (immutability, FR-013) — unlike spec 025's tenant delete, which has no such
guard, since nothing clones out of a tenant's own attachments.

## `POST /admin/platform-course-content-items/:id/scorm-import`

**Body**: `{ attachmentId }` — the confirmed `.zip` attachment to import as a SCORM package.

Runs the existing manifest-parsing logic (spec 027, research.md §6) against the platform tables:
creates one `platform_course_content_items` row per SCO in the same `platform_course_module_id` the
upload target belonged to, positioned immediately after it — identical behavior to spec 027's tenant
import, just writing platform rows instead of tenant rows.

**Errors**: `409` if the owning platform course has ≥1 `fulfilled` selection.

---

## `GET /admin/marketplace-selections` (Super Admin selection queue)

Lives in `apps/api/src/course-marketplace/admin-marketplace-selection-routes.ts`, gated
`requireSuperAdminSession`, reads via `request.superAdminDb` (research.md §3 — `super_admin_full_access`
policy, cross-tenant).

**Query**: `status` filter, defaults to `requested`.

**Response** `200`: array of `{ id, tenantId, tenantName, platformCourseId, platformCourseTitle,
status, requestedByUserId, requestedByName, requestedAt }`.

## `POST /admin/marketplace-selections/:id/resolve`

**Body**: `{ decision: "paid" | "rejected" }`.

- `paid` → runs `clonePlatformCourseIntoTenant` (research.md §5) against a connection scoped to the
  selection's own `tenant_id` via `withTenantConnection` (research.md §4); on success sets `status:
  "fulfilled"`, `clonedCourseId`, `resolvedBySuperAdminId`, `resolvedAt`.
- `rejected` → sets `status: "rejected"`, `resolvedBySuperAdminId`, `resolvedAt`; no clone.

**Errors**: `404` unknown selection id or already-resolved (`status != 'requested'`) — a resolved
selection cannot be re-resolved. `401`/`403` no valid Super Admin session.
