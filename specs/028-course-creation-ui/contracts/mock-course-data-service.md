# Contract: Mock Course Data Service

`apps/web/lib/mock-course-data.ts` — the in-memory store every route/component in this spec reads and
writes through. No HTTP contract exists (spec is UI-only, Clarifications); this is the equivalent
"interface" contract for a UI-only spec, per the planning workflow's own guidance. Every function here is
synchronous (no `Promise`, no `await`) since there is no network involved — the named follow-up wiring
spec is expected to make these `async` and swap the body for a real `fetch` call, without changing any
call site's surrounding logic more than adding an `await`.

## Seed data

`getCourses()` returns a mutable module-level array seeded on first import with **3 sample courses**
(spec FR-021) — a mix of statuses (draft, active) and content types, so "edit an existing course," the
curriculum outline, and drag-and-drop reordering are all demoable without the admin creating anything
first.

## Course functions

```ts
getCourses(): MockCourse[]
getCourse(courseId: string): MockCourse | undefined
createCourse(input: { title: string; categoryName: string; deliveryMode: DeliveryMode; durationValue: number; durationUnit: DurationUnit; provider?: string; cost?: number }): MockCourse
  // Resolves categoryName to an existing MockCourseCategory (case-insensitive) or creates one
  // (research.md §4, mirrors spec 023's resolve-or-create). Throws a validation error object
  // (not an exception) — see "Validation errors" below — if any required field is missing/invalid.
updateCourseDetails(courseId: string, input: Partial<{ title, categoryName, deliveryMode, durationValue, durationUnit, provider, cost }>): MockCourse
setCourseStatus(courseId: string, status: "draft" | "active" | "archived"): MockCourse
```

## Category functions

```ts
getCategories(): MockCourseCategory[]
```
(No standalone create function — categories are only ever created as a side effect of `createCourse`/
`updateCourseDetails`, matching spec 023's own "no dedicated category-write endpoint" precedent.)

## Module functions

```ts
addModule(courseId: string, title: string): MockCourseModule   // appended to the end
renameModule(moduleId: string, title: string): MockCourseModule
reorderModules(courseId: string, orderedModuleIds: string[]): void
  // orderedModuleIds MUST be an exact permutation of the course's current moduleIds — mirrors spec
  // 024's own reorder-endpoint validation (rejects a partial/mismatched list).
deleteModule(moduleId: string): void   // cascades: deletes every content item in it too
```

## Content-item functions

```ts
addContentItem(moduleId: string, input: { type: ContentItemType; title: string; description?: string; payload: ContentItemPayload }): MockContentItem
  // Runs the same per-type payload validation as content-item-payload-validation.ts (data-model.md).
updateContentItem(contentItemId: string, input: Partial<{ title, description, payload }>): MockContentItem
reorderContentItems(moduleId: string, orderedContentItemIds: string[]): void
deleteContentItem(contentItemId: string): void
simulateScormUpload(moduleId: string, fileName: string, scoCount: 1 | 2 | 3): Promise<{ packageId: string; scos: { contentItemId: string; title: string; position: number }[] }>
  // The one async function in this contract — deliberately Promise-based since it fakes a multi-step
  // upload+import sequence with progress callbacks (research.md §6), even though nothing real is
  // transmitted. Creates one MockContentItem per resulting sco, added to the module in order.
```

## Validation errors

Every write function that can fail validation returns `{ error: string }` instead of throwing, mirroring
this codebase's own established API-layer convention (e.g. `validateContentItemPayload`,
`validateProgressUpdate`) — callers check for `"error" in result` before treating the result as success,
the same pattern every route handler in `apps/api` already uses.

## React integration

```ts
useMockCourses(): MockCourse[]              // useSyncExternalStore-backed, re-renders on any store mutation
useMockCourse(courseId: string): MockCourse | undefined
```

## Non-goals (explicitly out of scope for this contract)

- No real network call anywhere (spec FR-020).
- No persistence across a page refresh (spec Edge Cases) — the store re-seeds from scratch on each fresh
  page load/import.
- No multi-tab/multi-session synchronization — each browser tab gets its own independent store instance.
