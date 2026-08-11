# AI-Native Multi-Tenant LMS: Architecture & MCP Integration Proposal

**Status:** Originally written as a pre-implementation proposal on 2026-08-09. **Since then, Phases 1–6 of the roadmap below have been implemented for the Forms domain** (service extraction, AI tool registry, provider abstraction, execution state machine, AI API routes, and a tenant-admin chat UI) — see `docs/ai-foundation-architecture.md` for how that implementation actually works, file:line accurate as of this update. This document has been revised in the sections below that implementation touched (marked **[IMPLEMENTED]**/**[PARTIAL]**); everything else remains the original pre-implementation proposal and should be read as **[PLANNED]**, not yet built.

**Stack confirmed by audit:** Turborepo/pnpm monorepo. `apps/api` = Fastify 5 + Drizzle ORM + Postgres (RLS-enforced), Cloudflare R2 (S3-compatible) storage, ZeptoMail for email. `apps/web` = Next.js App Router, `@tanstack/react-query`, a shared `packages/ui` component library. **As of this update**, an Anthropic-backed AI provider abstraction, AI tool registry, and Forms AI tools exist (`apps/api/src/ai/*`) — the "no AI/LLM SDK" statement below described the pre-implementation state only. No background job/queue system and no analytics aggregation layer exist anywhere in the codebase today.

**Important — a section of this document is now stale relative to the code regardless of the AI work**: Section 1.6 below described "Forms" as the original audit found it (a fixed-schema custom-fields framework, no generic form builder, form-type creation migration-only). A separate, unrelated merge from `master` (after this document's original audit) introduced a genuine, versioned, generic Form Builder module (spec 033, `apps/api/src/form-builder/*`) that **superseded** most of Section 1.6's description before any AI code was written against it. Section 1.6 has been rewritten below to describe the actual current form architecture; the AI tool layer was built against this live module, not the one originally described.

---

## 1. Current Architecture (as it actually exists)

### 1.1 Multi-tenancy & tenant identification

Tenant identity is never client-supplied and never becomes a raw ID until deep inside a validated session:

1. `apps/web/middleware.ts:107-227` parses the `Host` header. Root domain / `www` → no tenant (marketing). Paths under `ROOT_ONLY_PATH_PREFIXES` (`/platform`, `/admin`, `/tenants`, `middleware.ts:8`) 404 on any tenant subdomain.
2. For a subdomain, middleware calls the API's unauthenticated `GET /tenant-routing/resolve?subdomain=` (`apps/api/src/tenant-routing/tenant-routing-routes.ts`), caches the result in an **HMAC-signed**, 60s-TTL cookie (`tm_tenant_resolve_cache`, `middleware.ts:63-105`), then rewrites the request injecting `x-tenant-subdomain`/`x-tenant-name` headers — **never a tenant ID** (`middleware.ts:187,210`). The resolve route deliberately omits `tenantId` from its response body (`tenant-routing-routes.ts:20-26`).
3. `/tenant-api/*` and `/platform-api/*` are Next.js rewrite proxies to Fastify and re-resolve tenant server-side themselves (`middleware.ts:141-143`).
4. On the API, the real `request.user.tenantId` comes only from `tenant-user-context.ts:27-91`: it re-resolves the subdomain, reads a signed session cookie, and validates it against a live `user_sessions` row scoped to that resolved tenant. A code comment at `tenant-context.ts:15-17` states this explicitly: tenant ID comes "ONLY from `request.user.tenantId`... never from a client-supplied header/body/query value."

### 1.2 Tenant isolation at the database level (RLS)

Every tenant-scoped table has `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` (forces RLS even for the table owner), with the standard policy pattern (e.g. `apps/api/drizzle/0002_rls_roles.sql`):

```sql
CREATE POLICY "tenant_isolation" ON "<table>"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

`current_setting(..., true)` returns `NULL` when unset, and `col = NULL` is never true — **isolation fails closed**. Per-request, `apps/api/src/plugins/tenant-context.ts:23-46` opens a **dedicated pooled connection**, runs `BEGIN`, then `SELECT set_config('app.tenant_id', $1, true)` (parameterized, transaction-local), and binds `request.tenantDb` to that same physical connection; commit/rollback happens on `onResponse`/`onError`. Two additional narrow, OR'd permissive policies exist for pre-auth lookups (`tenant_subdomain_lookup`, gated on a server-only `app.subdomain_lookup` flag) and for super-admin cross-tenant access (`super_admin_full_access`, gated on `app.is_super_admin`).

Defense in depth: the application DB role `tm_app` has **no BYPASSRLS**, and the permission/role-template catalog tables are `GRANT SELECT`-only for `tm_app` with `INSERT/UPDATE/DELETE` revoked (`0001_lock_catalog_grants.sql`) — they can only change via migration. **As long as any new code path runs through `request.tenantDb`/`request.superAdminDb`, RLS is structurally unbypassable.** This is the single most important fact for AI/MCP safety in this codebase: the isolation guarantee is real and enforced at the database, not just in application code.

One documented footgun: pooled Postgres connections "remember" a GUC was ever set (`current_setting` returns `''`, not `NULL`, on that physical backend thereafter), which can poison RLS quals that cast to `::uuid`. The code defensively pins `app.tenant_id` to the nil UUID before subdomain/super-admin lookups (`resolve-tenant.ts:38-46`, `super-admin-context.ts:56-65`). **Any new AI/MCP code that opens its own pooled connection and sets custom GUCs must replicate this pattern exactly.**

### 1.3 Authentication

Two entirely separate, mutually exclusive session systems — opaque bearer tokens in httpOnly cookies, never JWT:

- **Tenant users** (`apps/api/src/tenant-auth/*`): session token hashed and checked against `user_sessions` (`token_hash`, `revoked_at IS NULL`, `expires_at > now()`), scoped under the resolved tenant's RLS context. `requireTenantUserSession()` gates routes.
- **Super admins** (`apps/api/src/platform-auth/*`): cookie `SUPER_ADMIN_COOKIE_NAME`, validated against `super_admin_sessions`, decorates `request.superAdmin`/`request.superAdminDb`. `requireSuperAdminSession` explicitly rejects if both identities are somehow set on the same request — a hard guarantee the two can never co-occur.

### 1.4 RBAC

Tables: `permissions` (global catalog), `role_templates`/`role_template_permissions` (seeded presets, read-only to the app), `roles` (tenant-scoped; `tenant_id IS NULL` reserved for exactly one platform Super Admin role via a partial unique index — `db/schema/roles.ts:12-16`), `role_permissions`, `user_roles`.

Enforcement is a Fastify `preHandler` per route — `requirePermission(key)` / `requireAnyPermission(...keys)` (`apps/api/src/permissions/require-permission.ts:56-85`). The check itself runs a raw SQL join (`user_roles → role_permissions → permissions`) through `request.tenantDb`, with **no explicit tenant filter in the query** — it relies entirely on RLS already scoping `request.tenantDb` to the caller's tenant. Deny-by-default: zero `user_roles` rows → empty permission set → 403.

Role templates today: `super_admin` (platform-only), `hr_admin` (tenant admin), `manager` (approve/view-scoped), `employee` (zero admin permissions). Tenants can also create fully custom roles. Permission keys have evolved from coarse (`edit_content_library`) to granular CRUD (`department.create/edit/delete`, `forms.tenant.read/create/edit`, `team.view.all/department`) via an additive migration pattern that bridges old and new keys — a precedent any new AI permission keys should follow.

**Platform admin vs tenant admin is a separate identity system, not "a role with more permissions."** Super Admin power comes from `super_admin_sessions` + the `app.is_super_admin` GUC and its own RLS carve-outs; tenant admin power comes from ordinary `tenant_id`/RLS scoping. This clean separation is the model the AI/MCP layer must mirror: a platform-level AI session and a tenant-level AI session should never share one "AI service account."

### 1.5 Courses

- `courses` (`db/schema/courses.ts:14`): metadata-only — title, description, category, `learningObjectives[]`, `requirements[]`, `outlineOrder[]` (authoritative ordering), `status` (draft/active/archived).
- `course_modules` and `content_items` (`db/schema/course-content.ts:14,64`): tenant-scoped; `content_items.type` (video/article/live_class/test/assignment/external_import) is immutable once set; `payload` is validated per-type in application code (`content-item-payload-validation.ts`).
- **Platform catalog** (`platform_courses`, `platform_course_modules`, `platform_course_content_items`, `db/schema/platform-courses.ts`) is a parallel, `tenant_id`-less structure authored by Super Admins, protected only by `requireSuperAdminSession` (no RLS — same trust class as the permission catalog).
- **Marketplace**: `marketplace_selections` tracks a tenant's request against a platform course (`requested → paid → fulfilled`/`rejected`); on fulfillment, `course-marketplace/clone-platform-course.ts` deep-clones the platform course into the tenant's own `courses`/`course_modules`/`content_items`, tagging clones with `sourcePlatformCourseModuleId`/`sourcePlatformCourseContentItemId` so later platform edits can be reapplied (spec 032).
- **SCORM**: `scorm_packages` → `scorm_package_items` → runtime CMI state, imported via `fast-xml-parser` manifest parsing (`scorm/manifest-parser.ts`, `scorm/package-importer.ts`).
- **Progress**: `learner_content_progress` is a single current-state row per (tenant, user, content_item) — not attempt history. `contentItemId` deliberately has no FK, mirroring `file_attachments.entityId`.
- **Assignment**: `course_assignments` (`assigneeType` ∈ `all|user|department|role`, CHECK-constrained) with `startsAt`/`completionDeadline`; `resolveDeadlinesForCaller` (`tenant-course-routes.ts:109`) takes the earliest applicable date across rows.
- **Storage**: a provider-agnostic `StorageClient` interface (`storage/storage-client.ts`) backed by `R2StorageClient`; presigned-PUT uploads for images/attachments, server-side `putObject` for SCORM extraction.

Every mutating course route is gated by a **single** permission, `course.manage` — there is no `course.publish`/`course.delete`/`course.assign` distinction today.

### 1.6 Forms — a real, versioned Form Builder, layered on the original custom-fields framework [UPDATED]

**This section describes the current architecture, not the one originally audited.** The original text here (preserved in git history) described a fixed, migration-only, 3-form-type custom-fields framework with no generic form builder. That is no longer accurate — a separate `master` merge (spec 033, unrelated to the AI work) landed a genuine, versioned, generic Form Builder module that now owns all form *structure* authoring. The two systems are layered, not competing:

- **`apps/api/src/db/schema/custom-fields.ts`** — `form_definitions` (the form-type catalog; **`POST /platform/forms` now lets a Super Admin create a new form type at runtime** — `apps/api/src/form-builder/platform-form-routes.ts` — this is no longer migration-only), `form_fields` (extended with `formVersionId`/`formSectionId`), `form_field_order_overrides`, `custom_field_values` (unchanged — still the only place entity *answers* live, still no submissions concept, still no DB FK on `entity_id`).
- **`apps/api/src/db/schema/form-builder.ts`** (new) — `form_versions` (draft/published/archived snapshots of a form type's structure), `form_steps`, `form_sections` (both dual-owned: a platform version's own, or a tenant's own, never both), `tenant_form_cta_overrides`.
- **`apps/api/src/form-builder/get-effective-form.ts`** — `getEffectiveForm()`, the render-time resolver: merges the active published platform version's steps/sections/fields with the caller's own tenant fields/overrides, excluding anything hidden. This is genuinely new capability — no equivalent existed before spec 033.
- **`apps/api/src/form-builder/tenant-form-builder-routes.ts`** — the **live, currently-used-by-the-frontend** write surface: `POST/PATCH /tenant/forms/:formKey/fields`, `PUT .../fields/reorder`, plus visibility/help-text/cta/sections/steps routes. The *old* `apps/api/src/custom-fields/tenant-form-routes.ts` still has its own `POST/PATCH/PUT /tenant/form-fields*` routes registered in `server.ts`, but **the frontend no longer calls them** — they're dead code, kept registered but unused (confirmed by grepping `apps/web` for every call site). That file's `GET /tenant/form-definitions`, `GET /tenant/form-fields`, and `GET/PUT /tenant/custom-field-values` routes **are** still live (used for the form-type list, the builder's own field-management read, and entity value read/write, respectively).
- **`packages/form-builder`** — a new shared package: a `<FormRenderer>` plus one component per field type (13 types now, not 6: `text, textarea, number, email, url, date, datetime, select, multiselect, radio, checkbox, toggle, file, user_select`).

**Still true, unchanged by spec 033**: there is still no "submission" concept — `custom_field_values` still stores one row per `(tenant, entity, field)`, written directly onto the owning entity alongside its native columns. "Summarize/trend form responses" still has no ready-made data model.

**What this means for the AI layer** (implemented — see below): `FormService` (`apps/api/src/form-builder/form-service.ts`) was extracted from the **live** `tenant-form-builder-routes.ts` handlers, not from the dead `custom-fields/tenant-form-routes.ts` ones. "Create a new form type" via AI remains out of scope for the current AI tool catalogue (Super-Admin-only, and deliberately not built yet — see Section 15's Phase 8 exclusion list), even though the underlying capability now technically exists in the API for humans.

### 1.6a AI Foundation — what's actually implemented [IMPLEMENTED]

The architecture proposed in Sections 3–14 below has been partially built, for the Forms domain only. Concretely, as of this update:

| Proposed capability | Status |
|---|---|
| Application service layer (Section 11) | **Implemented for Forms only** — `form-builder/form-service.ts`. Courses/departments/etc. still have inline route logic, unchanged. |
| AI tool registry + contract (Section 3.1, Section 5) | **Implemented** — `apps/api/src/ai/types.ts`, `tool-registry.ts`. Generic, not Forms-specific. |
| Forms tool catalogue (Section 4) | **Implemented**: `list_form_fields`, `suggest_form_fields`, `create_form_field`, `update_form_field`, `reorder_form_fields`. Course/Users/Analytics tool catalogues in Section 4 remain **planned**, not built. |
| READ/WRITE execution state machine + confirmation (Section 6) | **Implemented** — `ai/execution-state-machine.ts`, `ai_tool_executions` table. Every mutating Forms tool requires confirmation, including `reorder_form_fields` (stricter than this document's original per-tool confirmation table — see `docs/ai-foundation-architecture.md` §6 for why). |
| AI context system (Section 7) | **Implemented for Forms only** — a `formKey` hint on the current chat turn, folded into the system prompt, never used for authorization. Course/analytics-selected-resource context: planned. |
| AI UX — global assistant, contextual AI, confirmation UI, activity history (Section 8) | **Implemented** — a Drawer-based assistant mounted in the tenant dashboard shell and the Forms Builder page, a proposal-confirmation UI, and `/settings/ai-activity`. Inline "Generate with AI" buttons on other pages, and platform-side AI UX: planned. |
| MCP (Sections 9–10) | **Not started**, as planned — explicitly deferred. |
| AI provider abstraction (Section 12) | **Implemented** — `ai/provider/*`, Anthropic adapter, `invokeAi()` wrapper mirroring `MailSender`/`sendMail()`. |
| AI observability/audit (Section 13) | **Implemented, narrower than proposed** — `ai_conversations`/`ai_messages`/`ai_tool_executions` exist and are populated; `ai_usage`/`ai_configurations`/`mcp_clients` remain **planned**, not built (AI enablement today is the `AI_PROVIDER_API_KEY` env var, not a DB-configurable setting). |
| Platform/tenant AI configuration UI (Section 14) | **Not started** — no settings UI exists to enable/disable AI or pick tools per tenant. |
| Course/Analytics/document-ingestion AI (Sections 3–4 course & analytics rows) | **Not started**, as planned. |

See `docs/ai-foundation-architecture.md` for the concrete request-flow explanation of what's implemented, and the end-of-phase deliverables reports (in conversation history) for exact file lists.

### 1.7 Backend application architecture

- **Bootstrap** (`apps/api/src/server.ts:49`): `cors` → `compress` → `@fastify/postgres` (connects as the restricted `tm_app` role) → `db` decorator → central error handler (strips internal error detail from 5xx responses) → `tenantUserContext` → `tenantContext` → `superAdminContext` → ~25 flat feature-route plugins.
- **Module pattern: "fat routes," no service/repository layer.** Confirmed across multiple modules (`departments`, `course-assignments`): route files import Drizzle schema tables directly and run validation, permission checks, and queries inline in the handler closure. **There is no existing service boundary an AI or MCP layer can call into without going through HTTP routing.** This is the single biggest architectural gap for the "shared tool layer" goal (Section 12 of the request) — it must be built, not reused.
- **Mail**: a genuinely good precedent — `MailSender` interface + one `ZeptoMailSender` adapter + a `sendMail()` wrapper enforcing cross-cutting guarantees (skip if unconfigured, 3s timeout, never throws) in one place. This is the pattern to mirror for an AI provider abstraction.
- **Background jobs/workers: do not exist.** All writes are synchronous inside the request's DB transaction. Any long-running AI operation (bulk course generation, document ingestion, quiz generation) needs a new async execution primitive.
- **Analytics/reporting: a total gap, not a partial one.** The tenant dashboard page (`apps/web/app/(dashboard-shell)/dashboard/page.tsx`) is a literal placeholder with a comment explicitly deferring real content and stating no fabricated data is shown. A repo-wide search for metrics/aggregation logic in `apps/api/src` returns nothing. Only row-level progress data exists (`learner_content_progress`).
- **Testing**: vitest integration tests boot a real Fastify server with real Postgres (RLS active), seed fixtures, and exercise routes via `server.inject(...)` — no mocking. Any AI tool layer's tests should follow this exact pattern.
- **No AI/LLM SDK, no job queue, no SSO/OAuth provider, no webhook system** exist anywhere in the dependency tree today (confirmed by exhaustive dependency and grep audit).

### 1.8 Frontend architecture

Four Next.js route groups: `(platform-shell)` (Super Admin, gated by `getPlatformSession()`), `(dashboard-shell)` (tenant admin/user, gated by `getTenantSession()`, nav built dynamically from the session's permission array), `(course-player)`, and `(course-marketplace-preview)`. **Both admin shells render through the same shared `AppShell` component** (`packages/ui/src/app-shell.tsx`) — this is the single mounting point for a cross-cutting AI entry point. Client-side API calls go through `tenantFetch()` (`lib/tenant-api-client.ts:23`), which any AI panel should reuse rather than inventing a new fetch path.

There is **no global React context** for user/tenant/role — session data is fetched server-side per route. `packages/ui` already has `Drawer`, `Modal`, `Popover`, and `Toast` primitives — a global AI assistant, inline "Generate with AI" buttons, and confirmation flows can all be built on these without new base components. Confirmed: **no chat panel, command palette, or notification surface exists anywhere today** (the `AppShell`'s notification bell prop is unused/unwired dead code from an earlier design). All AI UX is new UI surface, but it's cheap to build on what exists.

---

## 2. Problems / Gaps Summary

| Gap | Why it matters for AI |
|---|---|
| No service/repository layer — business logic lives inline in route handlers | The "shared tool layer" this proposal requires does not exist; it must be extracted from route handlers as part of Phase 2, not assumed |
| No background job/worker system | AI course/quiz generation, document ingestion, and marketplace-wide operations are inherently async; needs a new primitive |
| No analytics aggregation layer at all | Every analytics tool requested (`get_course_completion_metrics`, `get_overdue_learning`, etc.) is net-new work, not a wrapper around an existing endpoint |
| No quiz/assessment data model | `content_items.type = 'test'/'assignment'` exists as an enum placeholder only; AI-generated quizzes need a new payload schema designed first |
| No document text-extraction pipeline | "Create course from uploaded document" needs new ingestion infrastructure; only presigned-upload plumbing exists today |
| "Forms" = fixed 3-type custom-fields framework, not a generic form builder | "Create new form types" via NL requires either new runtime schema-authoring API (doesn't exist even for humans) or scoping AI down to field-level suggestions on the 3 existing types |
| No submissions table | "Summarize/trend form responses" has no ready data model; must be built as cross-entity queries over `custom_field_values` |
| Coarse permissions (`course.manage` gates everything) | No natural permission-level hook to require a stricter confirmation bar for AI-initiated mutations vs human ones — must be enforced in the new AI authorization layer itself |
| No general-purpose tenant activity/audit log | Only Super-Admin-against-tenant actions are audited today (`tenant_action_log`, etc.); an AI audit trail needs a genuinely new table |
| Permission checks are per-route, not centrally declared | No existing route→permission manifest to introspect; an AI tool catalogue mapping to permissions must be hand-built and kept in sync |
| No global auth choke point | Three sequential Fastify plugins (tenant-user-context → tenant-context → super-admin-context) — any new layer must slot in after them, not build a fourth identity path |
| No AI-adjacent UI surface | No chat drawer, command palette, or notification center exists — all AI UX is new, though built cheaply on existing `Drawer`/`Modal`/`Toast` primitives |

**What is strong and must not be bypassed:** Postgres RLS enforcement (fail-closed, `FORCE ROW LEVEL SECURITY`, no `BYPASSRLS` app role), the clean separation between tenant-session and super-admin-session identity systems, the additive/non-breaking permission-migration pattern, and the "route handlers only ever act through `request.tenantDb`/`request.superAdminDb`" discipline.

---

## 3. Proposed AI Architecture

### 3.1 Layering (the shared tool layer)

```
                         ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
                         │   Web UI    │  │  AI Chat /   │  │  MCP Server  │  │   Future:    │
                         │ (Next.js)   │  │  Copilot     │  │  (external   │  │   Mobile     │
                         │             │  │  (in-app)    │  │   agents)    │  │              │
                         └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                                │                 │                 │                 │
                                ▼                 ▼                 ▼                 ▼
                         ┌────────────────────────────────────────────────────────────────┐
                         │                    Fastify HTTP routes (existing)               │
                         │   apps/api/src/{courses,departments,custom-fields,...}-routes.ts│
                         └───────────────────────────┬────────────────────────────────────┘
                                                       │  (routes become thin: parse → call service → serialize)
                                                       ▼
                         ┌────────────────────────────────────────────────────────────────┐
                         │        NEW: Application Service Layer (apps/api/src/services)   │
                         │   CourseService, FormService, AssignmentService, AnalyticsService│
                         │   — one per domain, extracted from today's route handlers        │
                         └───────────────────────────┬────────────────────────────────────┘
                                                       │
                                                       ▼
                         ┌────────────────────────────────────────────────────────────────┐
                         │     NEW: AI Tool Registry (apps/api/src/ai/tools/*)              │
                         │  Each tool = {name, zod input/output schema, requiredPermission, │
                         │  tenantScope, mutating: bool, requiresConfirmation: bool,        │
                         │  handler: (ctx, input) => ServiceLayer call}                     │
                         └───────────────────────────┬────────────────────────────────────┘
                                                       │  same tools, two callers:
                                       ┌───────────────┴────────────────┐
                                       ▼                                 ▼
                         ┌──────────────────────────┐      ┌──────────────────────────────┐
                         │  In-app AI orchestrator   │      │      MCP server adapter       │
                         │  (provider-abstracted LLM │      │  (exposes same registry as    │
                         │   tool-calling loop)      │      │   MCP resources/tools over    │
                         │                            │      │   OAuth-scoped HTTP transport)│
                         └──────────────────────────┘      └──────────────────────────────┘
                                       │                                 │
                                       └────────────┬────────────────────┘
                                                     ▼
                         Every tool call still executes through request.tenantDb / request.superAdminDb
                         → Postgres RLS is the final, unbypassable enforcement point.
```

**Non-negotiable rule enforced by this design:** neither the in-app AI orchestrator nor the MCP server ever touches Drizzle/Postgres directly. They call named tools; tools call the service layer; the service layer runs through the exact same tenant-scoped Drizzle client every HTTP route uses today. This satisfies Section 12's "Avoid: AI → direct database access" requirement structurally, not by convention.

### 3.2 Why a service-layer extraction is Phase 1, not optional

Because today's business logic lives inline in route handlers (Section 1.7), an AI tool cannot be written as "call the existing function" — the function doesn't exist independent of its HTTP handler. The extraction should be incremental and scoped to only what AI/tooling needs first (courses, assignments, custom-fields/forms), not a big-bang refactor of all ~25 modules. Each extraction is a pure refactor (route becomes `parse → CourseService.createCourse(ctx, input) → reply`) with existing integration tests as the safety net (`server.inject(...)` tests keep passing unchanged).

---

## 4. Tool Catalogue

Every tool takes an implicit `ToolContext` (never client-supplied): `{ tenantId, userId, permissions[], isSuperAdmin, dbClient }`, resolved server-side exactly as `request.user`/`request.tenantDb` are today. Tools never accept `tenantId` as an input parameter.

### Forms / Custom Fields [IMPLEMENTED — see `apps/api/src/ai/tools/forms.ts`]

The five tools actually built (permissions/confirmation below match the shipped implementation, not the original pre-implementation plan — `reorder_form_fields` now requires confirmation, a deliberate tightening documented in `docs/ai-foundation-architecture.md` §6):

| Tool | Purpose | Key inputs | Mutating | Confirm? | Permission | Status |
|---|---|---|---|---|---|---|
| `list_form_fields` | List every field on a form type (system/platform/tenant, including hidden) | `formKey` | No | No | none (any authenticated session) | **Implemented** |
| `suggest_form_fields` | AI proposes new fields from an NL description, via a nested structured-output model call | `formKey`, `description` | No (proposal only) | N/A | `forms.manage.tenant` | **Implemented** |
| `create_form_field` | Add a field to an existing form type | `formKey`, field def | Yes | **Yes** | `forms.manage.tenant` | **Implemented** |
| `update_form_field` | Edit/archive a tenant-owned field | `formKey`, `fieldId`, changes | Yes | **Yes** | `forms.manage.tenant` | **Implemented** |
| `reorder_form_fields` | Reorder a form's fields | `formKey`, ordered ids | Yes | **Yes** (tightened from the original "low-risk, no confirm" plan) | `forms.manage.tenant` | **Implemented** |
| `validate_field_values` | Validate a set of values against field defs | values + fields | No | N/A | n/a | **Not built** — `FormService.validateFieldValues` exists and is unit-tested indirectly, but no tool wraps it yet (no product need surfaced) |
| `summarize_entity_submissions` | Summarize/trend custom-field values across entities | `formKey`, filters | No | N/A | — | **Not built** — still blocked on the "no submissions model" gap Section 1.6 describes |

Note: `create_form_type` (a truly new form/entity type) — **no longer accurate that this requires new infrastructure**; `POST /platform/forms` now exists (Section 1.6) and a Super-Admin-scoped `create_form_type` tool is technically buildable. It remains deliberately **out of scope** for the current AI tool catalogue regardless — this phase's brief explicitly excluded "generic runtime form-type creation," and the existing tools are all tenant-scoped, not platform-scoped.

### Courses

| Tool | Purpose | Key inputs | Mutating | Confirm? | Permission | Audit |
|---|---|---|---|---|---|---|
| `list_courses` / `get_course` | Read course(s) | filters / `courseId` | No | No | `course.view`/`course.manage` | Log read |
| `create_course_draft` | AI generates a full draft (course + modules + lessons + objectives) from an NL prompt, saved as `status: draft` | `prompt`, constraints | Yes (draft only) | Yes, before publish | `course.manage` | Full audit incl. generated content diff |
| `update_course` | Edit metadata/objectives | `courseId`, changes | Yes | Yes | `course.manage` | Full audit |
| `create_module` / `create_lesson` | Add structure to a course | `courseId`, defs | Yes | Yes | `course.manage` | Full audit |
| `generate_quiz` | Generate quiz questions for a lesson (requires new payload schema, Section 6) | `contentItemId`, topic/objectives | Yes (draft) | Yes | `course.manage` | Full audit incl. model+prompt |
| `publish_course` | Flip draft → active | `courseId` | Yes | **Always** (high impact) | `course.manage` | Full audit |
| `assign_course` | Assign to user/department/role/all | `courseId`, target | Yes | **Always** (affects many users) | `course.manage` | Full audit incl. affected-user count |
| `recommend_courses` | Suggest courses for a user based on role/gaps | `userId` | No | N/A | `course.view` + `team.view.*` | Log read |
| `identify_missing_content` | Flag courses with thin/incomplete structure | filters | No | N/A | `course.view` | Log read |
| `create_course_from_document` | Ingest uploaded doc → draft course (requires new ingestion pipeline, Section 6) | `fileAttachmentId` | Yes (draft) | Yes | `course.manage` | Full audit |

### Users / Assignment

| Tool | Purpose | Mutating | Confirm? | Permission | Tenant scope |
|---|---|---|---|---|---|
| `get_user` / `list_users` | Read | No | No | `team.view.department`/`team.view.all` | Own tenant only |
| `update_user` | Edit profile/role/department | Yes | Yes | `team.edit` | Own tenant |
| `assign_learning` | Bulk-assign courses to users/departments | Yes | **Always** | `course.manage` | Own tenant |

### Analytics (new — no existing aggregation to wrap)

| Tool | Purpose | Backing (net-new) query |
|---|---|---|
| `get_course_completion_metrics` | Completion rate by course/date range | Aggregate `learner_content_progress` + `course_assignments` |
| `get_department_metrics` | Completion/engagement rolled up by department | Join `learner_content_progress` → `users.department_id` |
| `get_user_learning_metrics` | Per-user progress/overdue summary | Join `learner_content_progress` + `course_assignments` for one user |
| `get_course_engagement` | Views/starts/drop-off per course | Aggregate `learner_content_progress` status transitions (needs status history — currently only current-state row, see Section 6) |
| `get_overdue_learning` | Users/courses past `completionDeadline` | New query: no such aggregate exists today (confirmed gap) |
| `compare_period_metrics` | This month vs last month | Same aggregates, two date windows |
| `generate_learning_summary` | Executive summary (NL) | LLM synthesis over the above tool outputs — **never** raw DB access |

All analytics tools are **read-only**, require a `*.view.*`/analytics-equivalent permission scoped to the caller's own visible department(s) or entire tenant (mirroring the existing `team.view.all` vs `team.view.department` split), and never require confirmation. They query only through `request.tenantDb`, so a department manager's AI queries are automatically restricted to their department by the same RLS + in-handler visibility logic (`training-need-visibility.ts` is the existing precedent for this pattern) that already governs their manual dashboard access.

---

## 5. Tenant Authorization Model for AI

1. **Every tool call requires a resolved `ToolContext`** built exactly like `request.user`/`request.tenantDb` — from a validated session, never from a prompt, tool argument, or MCP client claim.
2. **Tool-level permission mapping**: each tool declares its `requiredPermission`(s) using the *existing* permission keys (`course.manage`, `forms.tenant.edit`, etc.) — no parallel "AI permission" system. If a user's session doesn't have the permission, the tool call fails exactly like the equivalent UI action would (403), before any LLM ever sees a result.
3. **No "AI has access to everything."** A platform-level AI session (invoked from the `(platform-shell)`) only ever receives `request.superAdminDb`-backed tools (tenant lifecycle, marketplace curation). A tenant-level AI session only ever receives `request.tenantDb`-backed tools scoped to that tenant. These map 1:1 onto the two existing, structurally separate identity systems (Section 1.4) — there is no unified "AI service role" that spans both.
4. **Cross-tenant access is impossible by construction**, not by check: because tools execute through the RLS-bound `tenantDb`, even a bug in tool-selection logic cannot return another tenant's rows — the database itself refuses them.
5. **Resource-level checks reuse existing in-handler visibility logic** (e.g., a department manager's `list_users` tool call reuses the same department-subtree filtering as the human-facing team directory) rather than reimplementing scoping rules in the AI layer.

---

## 6. Human Approval for Mutations

Two execution paths, matching the user's required READ vs WRITE separation:

- **READ → reason → respond**: read-only tools execute immediately if the caller's permissions allow it. Results are returned to the LLM, which composes a natural-language answer. No new schema needed beyond an audit-log write.
- **WRITE → propose → confirm → execute → audit**: mutating tools never execute directly from an LLM's tool call. The tool call instead produces a **proposed action** (tool name, resolved arguments, a human-readable diff/summary, and the list of affected resource IDs) persisted as a new `ai_tool_executions` row with `status = 'pending_confirmation'`. The UI renders this proposal (see Section 7). Only an explicit user confirmation (a second, distinct API call, itself permission-checked) flips the row to `status = 'confirmed'` and actually invokes the underlying service-layer function.

**Confirmation tiers**, calibrated to existing product risk signals already visible in the codebase (e.g., `course.manage` gates both a single-field edit and a tenant-wide `assign_course` today with no distinction — the AI layer must add the distinction the app itself lacks):

- **Low-impact, single-resource** (e.g. `update_form_field`, `reorder_form_fields`): one-click confirm, diff shown inline.
- **High-impact / broad-blast-radius** (e.g. `publish_course`, `assign_course` to "all", bulk `assign_learning`, anything deleting/archiving): mandatory explicit confirmation showing affected-user/resource counts, with no "always auto-approve" setting available for these specific tools regardless of tenant AI settings.
- **Irreversible** (none of today's course/form mutations are hard-deletes — forms already only support archive-via-PATCH, no delete route exists, per `0038_seed_granular_crud_permissions.sql`'s own documented reasoning): if any future AI tool is destructive, it must go through the same tier-2 flow at minimum, with no exceptions.

---

## 7. AI Context System

A new, narrowly-scoped React context (following the existing `SubdomainProvider` pattern at `apps/web/lib/subdomain-context.tsx:13`, not a new global store) — `AiContextProvider` — carries only what the assistant needs to disambiguate "this course"/"this form":

```ts
type AiContext = {
  tenantId: string;        // never sent to the model as free text — used server-side to scope tool calls
  userId: string;
  roleSummary: string;     // e.g. "HR Admin" — for tone/scope framing, not authorization
  page: string;             // route name, e.g. "courses.detail"
  selectedResource?: { type: "course" | "form" | "user" | "department"; id: string; label: string };
  filters?: Record<string, unknown>;   // active analytics period/department filter, etc.
};
```

This is populated by each page (e.g. the course detail page sets `selectedResource = { type: "course", id, label: title }`), sent alongside a chat message, and used server-side only to (a) pre-fill tool arguments the model would otherwise have to ask for, and (b) label the conversation for the AI activity log. **It is never used for authorization** — authorization is always re-derived server-side from the session, per Section 5. Nothing beyond IDs/labels/route names is exposed to the model as ambient context; full resource contents are only pulled in when a tool is actually invoked.

---

## 8. AI UX

Built entirely on existing `packages/ui` primitives (`Drawer`, `Modal`, `Toast`, `Popover`) mounted inside the shared `AppShell` (Section 1.8) — no parallel design system needed:

- **Global AI Assistant**: a `Drawer` triggered from a persistent affordance in `AppShell` (consistent with the locked sidebar-only, no-topbar design from spec 008 — e.g. a bottom-pinned icon near the identity block, not a topbar element since the topbar is unwired dead code). Available in both `(platform-shell)` and `(dashboard-shell)` since both share `AppShell`.
- **Contextual AI**: the same drawer, opened with `AiContext.selectedResource` pre-populated, on course detail, form settings, department, team, and (once built) analytics pages.
- **Inline AI actions**: buttons using existing `Button`/`Popover` components next to relevant fields — "Generate with AI" on course creation, "Suggest fields" on the Forms settings field list, "Generate quiz" on a lesson's content editor, "Summarize" on a course's review list.
- **Confirmation UI**: mutating tool proposals render as a `Modal` with a structured diff (before/after, affected-resource list, affected-user count for assignment/publish actions), Confirm/Cancel buttons, and a `Toast` on execution success/failure.
- **AI Activity/History**: a new page (`/settings/ai-activity` for tenant admins, a platform-level equivalent under `/admin`) listing past conversations, executed tools with arguments/results, pending confirmations awaiting action, and failed executions — reading from the new `ai_tool_executions`/`ai_conversations` tables (Section 10).

---

## 9. MCP Architecture

MCP exposes the **same tool registry** from Section 4 to external agents — no duplicate implementation.

**Resources** (read-oriented, MCP `resources/list` + `resources/read`): `courses`, `forms` (custom-fields definitions), `users`, `departments`, `analytics` — each scoped to the authenticated agent's tenant, identical row-visibility to the equivalent in-app tool.

**Tools** (MCP `tools/call`): a curated subset of Section 4's registry — start narrow. Recommended initial exposure: `list_courses`, `get_course`, `create_course_draft`, `update_course`, `assign_course` (WRITE, mandatory confirmation callback), `list_form_fields`, `get_course_completion_metrics`, `get_overdue_learning`, `generate_learning_summary`. Do **not** expose tenant/role/user-management mutation tools via MCP in the first release — those stay in-app-only until the confirmation/audit flow has proven itself internally.

---

## 10. MCP Security

External agents are untrusted clients, full stop.

- **Authentication**: OAuth 2.1 (per current MCP spec convention) with a new `mcp_clients` table (client_id, tenant_id, allowed scopes, created_by_user_id) — an agent registers **against one tenant**, established by a human tenant admin explicitly granting it, never by the agent supplying a tenant ID at connect time. This mirrors the existing rule that tenant context always comes from a server-validated identity (Section 1.1), extended to machine identities.
- **Token strategy**: short-lived access tokens + refresh tokens, scoped (`courses:read`, `courses:write`, `analytics:read`, etc.) mapping to the same permission keys used internally — an MCP token can never grant a scope beyond what the *authorizing human user's* own role permits at grant time (checked at issuance, re-checked at every call since the human's role could later change).
- **Identity propagation**: every MCP tool call carries the agent's resolved `{tenantId, actingAsUserId, scopes}` — resolved server-side from the token, exactly like `request.user` — into the same `ToolContext` used by in-app tools. RLS applies identically.
- **Rate limiting**: per-client-id, per-tool, tracked in the new `ai_usage` table (Section 13).
- **Audit**: identical `ai_tool_executions` log as in-app tools, tagged with `source: 'mcp'` and the client_id, plus request tracing via a correlation ID returned in every MCP response.
- **Revocation/expiration**: tenant admins can revoke an `mcp_clients` row at any time (immediate — checked per-call, not cached beyond token TTL); tokens expire on a short cycle (e.g. 1 hour access / 30 day refresh).
- **Confirmation for sensitive actions**: WRITE tools invoked via MCP still go through the propose→confirm flow (Section 6) — the confirmation surfaces in the LMS's own AI Activity UI (Section 8) for the authorizing tenant admin to approve, since an external agent has no LMS UI of its own. This is the same mechanism, just with the human approver being whoever the MCP client was registered by.
- **Cross-tenant protection**: structurally guaranteed the same way as Section 5 — an MCP token's `tenantId` is fixed at issuance and drives `request.tenantDb` binding; it cannot be overridden by a parameter in the MCP request payload.

---

## 11. Shared Tool Layer (recap)

Already covered architecturally in Section 3; the concrete engineering task is: extract `CourseService`, `FormService` (wrapping custom-fields), `AssignmentService`, and a new `AnalyticsService` out of today's fat route handlers, with existing route handlers becoming thin callers of these services (zero behavior change, verified by existing integration tests), and the AI tool registry becoming a second caller of the same services. MCP becomes a third caller of the same tool registry — never a fourth independent implementation.

---

## 12. AI Provider Abstraction

Mirror the existing `MailSender` pattern (Section 1.7) exactly:

```ts
interface AiProvider {
  isConfigured(): boolean;
  chat(input: ChatInput): Promise<ChatResult>;         // supports tool-calling, structured output
  streamChat(input: ChatInput): AsyncIterable<ChatChunk>;
}
```

One concrete adapter to start (e.g. an Anthropic adapter), swappable later — no lock-in beyond the interface. A single wrapper (`invokeAi()`, mirroring `sendMail()`'s guarantees) enforces cross-cutting concerns in one place: timeout, token/cost accounting (writes to `ai_usage`), and tenant-level feature-flag/limit checks (Section 14) *before* the provider is ever called. Platform-level config (allowed providers/models, global cost ceiling) and tenant-level config (enabled/disabled, allowed tools, per-tenant usage cap) live in a new `ai_configurations` table with a platform-scope row (`tenant_id IS NULL`) and per-tenant override rows — the same `tenant_id IS NULL`-means-platform-default pattern already used by `form_fields` (Section 1.6).

---

## 13. AI Observability / Audit Model

New tables (justified individually below — nothing speculative):

- **`ai_conversations`** (`id`, `tenant_id` nullable for platform-level, `user_id`, `started_at`, `context` jsonb — the `AiContext` snapshot). Needed because there is currently zero conversational state anywhere.
- **`ai_messages`** (`conversation_id`, `role`, `content`, `created_at`). Standard chat history; needed for the AI Activity/History UX (Section 8).
- **`ai_tool_executions`** (`id`, `conversation_id` nullable (MCP calls may have none), `tool_name`, `arguments` jsonb, `result` jsonb, `status` ∈ `executed|pending_confirmation|confirmed|rejected|failed`, `mutating` bool, `requested_by_user_id`, `confirmed_by_user_id` nullable, `source` ∈ `web|mcp`, `mcp_client_id` nullable, `permission_checked` text, `tenant_id`, `duration_ms`, `error` nullable, `created_at`). This is the load-bearing audit table — it generalizes the existing bespoke pattern (`tenant_action_log`, `member_action_log`) into one AI-specific append-only log, following the same "no RLS, INSERT/SELECT-only grant" precedent (`0001_lock_catalog_grants.sql`-style lockdown) since it must remain tamper-evident regardless of the tenant context that produced it.
- **`ai_usage`** (`tenant_id`, `date`, `provider`, `model`, `tokens_in`, `tokens_out`, `cost_estimate`, `request_count`) — for cost tracking and rate limiting, aggregated daily.
- **`ai_configurations`** (`tenant_id` nullable, `enabled`, `allowed_tools` jsonb, `provider`, `model`, `usage_limit`, `cost_limit`) — platform default (`tenant_id IS NULL`) + tenant overrides.
- **`mcp_clients`** (`id`, `tenant_id`, `name`, `scopes` jsonb, `created_by_user_id`, `revoked_at` nullable) and **`mcp_tokens`** (or reuse an OAuth library's standard token tables) for external-agent identity.

**Explicitly not proposed**: a generic "agent identity" abstraction beyond `mcp_clients`, and no changes to the core `users`/`roles`/`permissions` tables — AI/MCP identities are additive, not a redesign of the existing RBAC model. Sensitive-data handling: `ai_messages.content` and `ai_tool_executions.arguments/result` should exclude raw PII where the underlying tool result already would (e.g., analytics tools return aggregates, not raw user rows, by design in Section 4) — no new PII exposure is introduced by logging tool calls that themselves never returned PII in bulk.

---

## 14. Platform Admin & Tenant Admin AI Configuration

- **Platform admin** (`ai_configurations` where `tenant_id IS NULL`, edited from a new page under `(platform-shell)/admin`): enable/disable AI platform-wide, configure allowed providers/models, set a global cost ceiling, define the master list of tools that can ever be enabled for any tenant, enable/disable MCP platform-wide, view cross-tenant AI audit logs and usage.
- **Tenant admin** (`ai_configurations` row for their `tenant_id`, edited from `(dashboard-shell)/settings`, new "AI" tab alongside existing Authentication/Forms/Roles tabs): enable/disable AI for their tenant (within platform-allowed bounds), choose which of the platform-allowed tools are enabled for their users, set their own usage/cost limits (capped by platform ceiling), manage their own `mcp_clients` (create/revoke), view their own tenant's AI activity log.

This mirrors the existing platform-default/tenant-override pattern already established for custom fields (`form_fields.tenant_id IS NULL` vs tenant-specific) — no new authorization concept is introduced, just a new configuration domain using the established shape.

---

## 15. Implementation Roadmap

### Phase 1 — AI Foundation (no user-facing AI yet)
- **Objective**: stand up schema, provider abstraction, and config, with zero behavior change to the app.
- **DB**: `ai_configurations`, `ai_usage` migrations (RLS + grants following existing patterns).
- **API**: `apps/api/src/ai/provider/*` (`AiProvider` interface + one adapter + `invokeAi()` wrapper).
- **Frontend**: none yet.
- **Dependencies**: none (greenfield).
- **Risks**: low — additive only.
- **Testing**: unit tests on the provider wrapper's guarantees (timeout, skip-if-unconfigured), mirroring `send-mail.test.ts`-style coverage if it exists.

### Phase 2 — Service Layer Extraction
- **Objective**: extract `CourseService`, `FormService`, `AssignmentService` from existing fat routes with zero behavior change.
- **Files affected**: `apps/api/src/courses/*`, `apps/api/src/course-content/*`, `apps/api/src/course-assignments/*`, `apps/api/src/custom-fields/*` — routes become thin.
- **DB**: none.
- **API**: no external contract change.
- **Dependencies**: Phase 1 not required, can run in parallel.
- **Risks**: regression risk in high-traffic modules — mitigate by relying on existing `server.inject(...)` integration tests as the refactor's safety net; do not extract modules without existing test coverage first.
- **Testing**: existing integration tests must pass unchanged; add service-level unit tests.

### Phase 3 — AI Tool Registry + Audit Log
- **Objective**: build the tool registry (Section 3.1) wrapping Phase 2 services; build `ai_tool_executions` and the propose/confirm state machine.
- **DB**: `ai_tool_executions`, `ai_conversations`, `ai_messages`.
- **API**: `apps/api/src/ai/tools/*`, `apps/api/src/ai/routes.ts` (chat endpoint, confirm/reject endpoints).
- **Frontend**: none yet (test via API directly).
- **Dependencies**: Phases 1 & 2.
- **Risks**: getting the confirmation-tier defaults wrong (Section 6) — start every mutating tool at the strictest tier and relax deliberately per-tool, not the reverse.
- **Testing**: new integration tests following the existing `buildTestServer()`/fixture pattern, covering permission-denial paths explicitly (a tool call from a user lacking the permission must 403 before touching the LLM).

### Phase 4 — Forms AI (narrowest surface, lowest risk)
- **Objective**: `suggest_form_fields`, `create_form_field`, `update_form_field`, `reorder_form_fields`, `validate_field_values` wired to the UI.
- **Frontend**: "Suggest fields" inline action in `forms-settings-client.tsx`; confirmation modal for field creation.
- **Risks**: low — smallest blast radius (no delete route exists for fields at all today).
- **Testing**: extend existing forms integration tests with AI-tool-driven cases.

### Phase 5 — Course Creation AI
- **Objective**: `create_course_draft`, `create_module`, `create_lesson`, `update_course`, `publish_course` (confirmation-gated), `assign_course` (confirmation-gated).
- **Dependencies**: quiz support (`generate_quiz`) blocked on designing the `type: 'test'` payload schema first — treat as a sub-phase (5b) since it's genuinely new product surface, not just an AI wrapper.
- **Risks**: `publish_course`/`assign_course` are the highest-blast-radius tools in the catalogue — ship these last within the phase, after the confirmation UI (Phase 7) exists.

### Phase 6 — Analytics AI
- **Objective**: build the net-new aggregation queries (Section 4's analytics table) as plain service-layer functions first (usable by a future real dashboard regardless of AI), then wrap as read-only tools.
- **DB**: no schema change needed if built as aggregate queries over existing tables; consider a materialized view for `get_course_completion_metrics` if query cost is high at scale.
- **Risks**: this phase also effectively builds the "Reports & Analytics" feature the frontend nav already stubs out as "Soon" — coordinate with product so it isn't duplicated later as a separate non-AI initiative.

### Phase 7 — Contextual AI UX
- **Objective**: `AiContextProvider`, global `Drawer` assistant, inline actions, confirmation `Modal`/`Toast` flows, AI Activity page.
- **Frontend**: mounted in `AppShell`; new `/settings/ai-activity` and platform equivalent.
- **Dependencies**: Phases 3-6 for content to actually act on.

### Phase 8 — Background Job Infrastructure
- **Objective**: introduce the async execution primitive needed for long-running generation (document ingestion, bulk quiz generation) — a jobs table + poller is sufficient given current scale; do not over-engineer into a full queue system unless volume demands it.
- **Risks**: this is genuinely new infrastructure for the whole app, not just AI — evaluate whether SCORM import (currently synchronous) should also move onto it, to avoid two parallel async patterns.

### Phase 9 — MCP Foundation
- **Objective**: OAuth client registration (`mcp_clients`), token issuance/validation, MCP server exposing the Phase 3 tool registry read-only tools first.
- **Risks**: OAuth implementation correctness — recommend a well-audited library over a hand-rolled flow given the security stakes.

### Phase 10 — MCP Write Tools, Rate Limiting, Production Hardening
- **Objective**: expose confirmation-gated write tools via MCP, `ai_usage`-backed rate limiting, request tracing, revocation UI, cost-limit enforcement.
- **Risks**: this is where cross-tenant-access mistakes would be most damaging — require a dedicated security review pass before enabling any tenant's MCP write access in production.

Document creation from uploads and generic "new form type" authoring are intentionally **not scheduled** in Phases 1-10 — both require net-new product infrastructure (document text extraction; runtime schema authoring) beyond what a phased AI rollout should absorb up front. Revisit after Phase 6 once usage patterns clarify whether they're actually needed.

---

## 16. Prioritized First 5-10 Implementation Tasks

1. **Stand up `ai_configurations`/`ai_usage` migrations and the `AiProvider` interface + one adapter**, following the `MailSender` pattern exactly (Phase 1). Zero user-facing risk, unblocks everything else.
2. **Extract `FormService` from `apps/api/src/custom-fields/*`** — smallest, lowest-risk module (no delete route, well-understood schema) to prove the service-extraction pattern before touching courses.
3. **Build the AI tool registry shape + `ai_tool_executions` table + propose/confirm state machine** (Phase 3), tested against `FormService` first with 2-3 real tools (`create_form_field`, `update_form_field`).
4. **Extract `CourseService`/`AssignmentService`** from the course route handlers (Phase 2), reusing the pattern validated in task 2.
5. **Ship Forms AI end-to-end** (`suggest_form_fields`, `create_form_field` with confirmation UI) as the first real user-facing AI feature — smallest surface, validates the full stack (provider → tool → confirm → audit → UI) before extending to higher-stakes course mutations.
6. **Design the `type: 'test'` content-item payload schema** (questions/options/correct-answer/explanation/scoring) as a standalone product decision, independent of AI — this is a genuine schema gap blocking `generate_quiz` regardless of who authors quizzes.
7. **Build the analytics service layer** (`get_course_completion_metrics`, `get_overdue_learning`, department rollups) as plain aggregate queries — valuable even before any AI wraps them, and unblocks both the AI analytics tools and the still-unbuilt "Reports & Analytics" nav stub.
8. **Ship Course Creation AI for draft-only operations** (`create_course_draft`, `update_course`, `create_module`/`create_lesson`) with mandatory confirmation before `publish_course`/`assign_course` are even attempted.
9. **Build the AI Activity/History UI + global assistant Drawer** (Phase 7), so the confirmation and audit machinery built in tasks 3-8 becomes actually usable rather than API-only.
10. **Begin MCP foundation** (`mcp_clients` + OAuth token flow) only after tasks 1-9 have proven the tool registry and confirmation flow internally — do not parallelize MCP with the initial in-app AI build, since MCP inherits every tool's correctness and security assumptions.
