# Contract: Course Marketplace API (tenant-facing)

Routes live in `apps/api/src/course-marketplace/tenant-marketplace-routes.ts`, registered alongside the
other tenant-scoped route plugins. Every route requires `requireTenantUserSession()` then
`requirePermission("course.manage")` (spec Clarifications — reused, no new permission key) and operates
through `request.tenantDb` for tenant-scoped reads/writes; platform-catalog reads go through
`fastify.db` (no `tenant_id` to scope on the platform tables themselves — the permission check is what
gates access, not RLS).

## `GET /tenant/course-marketplace`

**Query**: `search` (title substring), `category`, `deliveryMode`, `cost` (`free` | `paid`) filters.

**Response** `200`: array of platform courses with `status = 'active'` only — `draft`/`archived` never
appear, regardless of filters. Same summary field set as the tenant's own `GET /tenant/courses` list
(spec 023) plus `alreadySelected: boolean` (true if the caller's tenant has any non-`rejected`
`marketplace_selections` row for this platform course).

## `GET /tenant/course-marketplace/:platformCourseId`

**Response** `200`: full platform course detail plus curriculum outline (modules → content items,
same shape as `platform-course-authoring-api.md`'s detail response, read-only here). `alreadySelected`
and, if true, that selection's `status`.

**Errors**: `404` if the id doesn't resolve to an `active` platform course — identical response whether
the id is invalid, doesn't exist, or belongs to a `draft`/`archived` course (spec Edge Cases — no
distinguishing signal). `403` if the caller lacks `course.manage`.

## `POST /tenant/course-marketplace/:platformCourseId/select`

**Response** `201`, one of two shapes depending on the platform course's `cost`:

- **Free** (`cost` null/0): clones immediately via `clonePlatformCourseIntoTenant` (research.md §5)
  against `request.tenantDb`. `{ outcome: "cloned", courseId: "uuid" }` — the new course id in the
  tenant's own catalog, immediately usable exactly like a tenant-authored course.
- **Paid** (`cost` > 0): creates a `marketplace_selections` row, `status: "requested"`. `{ outcome:
  "requested", selectionId: "uuid" }` — no course id yet.

**Errors**: `404` same as detail endpoint. `409` if the caller's tenant already has a non-`rejected`
selection for this platform course (FR-009 — enforced by the partial unique index, so this is a
constraint-violation catch, not merely a pre-check that can race). `403` if the caller lacks
`course.manage`.

## `GET /tenant/course-marketplace/selections`

**Response** `200`: the caller's own tenant's `marketplace_selections` (all statuses), via
`request.tenantDb` — `tenant_isolation` policy applies normally, no cross-tenant visibility. Lets a
tenant admin see the status of their own pending paid requests.
