# Data Model: Course Creation UI

No backend schema changes — this spec is UI-only (spec Clarifications). Every shape below lives entirely
in `apps/web/lib/mock-course-data.ts`'s in-memory store, mirroring the real backend entities exactly
(research.md §4) so a follow-up wiring spec can swap the store's functions for real API calls without a
data-shape translation layer.

## `MockCourse`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | client-generated (e.g. `crypto.randomUUID()`) |
| `title` | `string` | required |
| `description` | `string \| null` | |
| `categoryId` | `string` | references a `MockCourseCategory.id` |
| `deliveryMode` | `"in_person" \| "virtual" \| "self_paced" \| "blended"` | mirrors spec 023's `courses.delivery_mode` CHECK |
| `durationValue` | `number` | `> 0`, mirrors `courses.duration_value` |
| `durationUnit` | `"minutes" \| "hours" \| "days"` | mirrors `courses.duration_unit` CHECK |
| `provider` | `string \| null` | |
| `cost` | `number \| null` | `>= 0` when present, mirrors `courses.cost` |
| `status` | `"draft" \| "active" \| "archived"` | mirrors `courses.status` CHECK; defaults to `"draft"` on creation |
| `moduleIds` | `string[]` | ordered list of `MockCourseModule.id`, defines module order |

## `MockCourseCategory`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | client-generated |
| `name` | `string` | unique (case-insensitive) within the mock dataset, mirrors spec 023's resolve-or-create-by-name behavior |

## `MockCourseModule`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | client-generated |
| `courseId` | `string` | owning `MockCourse.id` |
| `title` | `string` | required |
| `description` | `string \| null` | |
| `contentItemIds` | `string[]` | ordered list of `MockContentItem.id` within this module |

## `MockContentItem`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | client-generated |
| `moduleId` | `string` | owning `MockCourseModule.id` |
| `type` | `"video" \| "article" \| "live_class" \| "test" \| "assignment" \| "external_import"` | mirrors spec 024's `content_items.type` CHECK exactly — 6 values, no separate "text" type (article already covers free-text-or-URL) |
| `title` | `string` | required |
| `description` | `string \| null` | |
| `payload` | `ContentItemPayload` | shape depends on `type`, see below — mirrors spec 024's own per-type payload validation exactly |

### `ContentItemPayload` per type (mirrors `apps/api/src/course-content/content-item-payload-validation.ts`)

| Type | Required payload fields |
|---|---|
| `video` | `url: string` |
| `article` | `body: string` **or** `externalUrl: string` (at least one) |
| `live_class` | `scheduledAt: string` (ISO datetime) |
| `test` / `assignment` | none — placeholder-shell, title/description only |
| `external_import` (plain URL) | `url: string`, `sourceType: string` (e.g. `"link"`) |
| `external_import` (SCORM upload) | `sourceType: "scorm"`, plus a mock `scormPackage: { packageId: string; scos: { contentItemId: string; title: string; position: number }[] }` result once the simulated upload completes (research.md §6) |

**Validation rules** (client-side, mirroring `content-item-payload-validation.ts`'s own rules exactly):
- `video`: `payload.url` required, non-blank.
- `article`: at least one of `payload.body` / `payload.externalUrl` required, non-blank.
- `live_class`: `payload.scheduledAt` required.
- `test`/`assignment`: no payload validation beyond title/description.
- `external_import`: `payload.url` + `payload.sourceType` required for the plain-URL sub-choice; the
  SCORM sub-choice instead requires a completed (simulated) upload before the content item can be saved.

## Relationships

```
MockCourse            1──* MockCourseModule       (in-memory, via moduleIds ordering)
MockCourseModule      1──* MockContentItem         (in-memory, via contentItemIds ordering)
MockCourse            *──1 MockCourseCategory       (in-memory, via categoryId)
```

No tenant/user/permission dimension exists in the mock data — every mock course is visible to whichever
session is running the app (this iteration has no multi-tenant mock separation, since there is no real
backend to enforce it against; the real backend already enforces this today for when this UI is wired
up).

## Derived concepts (not stored — computed at render time)

- **Course list view**: `getCourses()` returns every `MockCourse`, each with its category name resolved
  and its total module/content-item counts, for the list page.
- **Curriculum outline**: for a given course, resolves `moduleIds` → `MockCourseModule` rows (in order)
  → each module's `contentItemIds` → `MockContentItem` rows (in order), for the editor's outline panel.
