# AI Foundation — How It Works

**Status:** implemented, Forms domain only, backend AND frontend (Phase 2 added a real tenant-admin chat UI on top of Phase 1's API-only foundation). Not yet: MCP, other domains, background jobs, per-tenant AI settings, tenant-wide admin oversight of AI activity (each user sees only their own). See the end-of-task deliverables report for what's next.

This document explains the concrete request flow for the AI Foundation built across two passes, so a
reader can trust the security properties without re-deriving them from the code. Section 8 covers
what Phase 2 added; Sections 1–7 are unchanged from Phase 1 and remain accurate.

---

## 1. How an AI request enters the application

A tenant admin talks to the assistant through three routes, all in `apps/api/src/ai/routes.ts`,
all gated by the **existing** tenant session system (`requireTenantUserSession()` —
`tenant-auth/require-tenant-user-session.ts`), registered in `server.ts` after
`tenantUserContext`/`tenantContext` exactly like every other route module:

```
POST /ai/conversations                       — start a conversation
POST /ai/conversations/:id/messages          — send a message, get a response
POST /ai/tool-executions/:id/confirm         — confirm a pending mutation
POST /ai/tool-executions/:id/reject          — reject a pending mutation
```

There is no fourth authentication mechanism. A platform-level AI surface (for Super Admins) would
be a separate set of routes gated by `requireSuperAdminSession`, mirroring the same tenant/platform
split every other subsystem already uses — not built in this pass (Forms is tenant-only).

## 2. How tenant context is resolved

Never from the request. `apps/api/src/ai/tool-context.ts`'s `buildToolContext(request)` reads
`request.user.tenantId` and `request.user.id` — the same fields `tenant-user-context.ts` decorates
from a verified `user_sessions` row, and hands back `request.tenantDb`, the same RLS-bound Drizzle
instance every other route uses (`plugins/tenant-context.ts`). This produces a `ToolContext`:

```ts
{ tenantId: string; userId: string; db: Db }
```

No tool's Zod `inputSchema` includes a `tenantId` field, and no tool implementation reads one off
its input — `ai/tools/forms.ts`'s five tools all take `ctx.tenantId` implicitly via `ctx.db`. An
integration test (`tenant ID injection`, `tests/integration/ai-foundation-forms.test.ts`) proves
this directly: passing an extra `tenantId` field in a tool call's input has no effect — the created
row's real `tenant_id` column is always the session's own tenant.

## 3. How permissions are checked

`ai/execution-state-machine.ts`'s internal `authorize()` calls `userHasAnyPermission` —
**the exact function** `permissions/require-permission.ts`'s `requirePermission`/
`requireAnyPermission` preHandlers already use for every HTTP route. A tool declares
`requiredPermissions: string[]` (existing permission keys — `forms.manage.tenant` for every
mutating Forms tool; `[]`, meaning "any authenticated session," for `list_form_fields`, mirroring
`GET /tenant/form-fields`'s own long-standing openness). There is no separate "AI permission"
system, and the check runs through `ctx.db` (RLS-bound), so it's automatically scoped to the
caller's own tenant with no explicit tenant filter — the same pattern the permission check itself
already relies on everywhere else in this codebase.

This check runs **twice** for a mutating tool: once when the proposal is created, and
**independently again** when it's confirmed (`confirmToolExecution`) — a role change in between
takes effect (proven by the `permission changed after proposal` test).

## 4. How tools invoke services

```
ai/tools/forms.ts  →  form-builder/form-service.ts  →  request.tenantDb (RLS-bound)
```

`FormService` (`form-builder/form-service.ts`) is the extracted application-service layer —
`getEffectiveForm`, `listFields`, `createField`, `updateField`, `archiveField`, `reorderFields`,
`validateFieldValues`. It was pulled out of `form-builder/tenant-form-builder-routes.ts`'s
handlers with **zero behavior change** (verified: all pre-existing form-builder integration tests
pass unchanged), and those HTTP routes now call the same service the AI tools call — there is
exactly one implementation of "create a form field," used by both the web UI and the AI layer.
This is the "shared tool layer" principle made concrete for one domain; extending it to
courses/departments/etc. is future-phase work, not yet done.

A tool's `execute()` never imports Drizzle schema or issues a query directly — it only calls
`FormService` methods, passing through the `ToolContext.db` it was given.

## 5. How RLS protects the database

Nothing new here — the AI layer adds no new isolation mechanism, it inherits the existing one.
Every tool's `execute()` runs through `ctx.db`, which is `request.tenantDb`: a transaction with
`SELECT set_config('app.tenant_id', $1, true)` already applied, matched against every table's
`tenant_isolation` RLS policy (`USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`).
The three new AI tables (`ai_conversations`, `ai_messages`, `ai_tool_executions`) get the identical
`ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_isolation` treatment as every other tenant table
(migration `0121_rls_ai_foundation.sql`) — proven by the `RLS enforces isolation at the database
level` test, which reads an execution row through a different tenant's `withTenantDb` context and
gets zero rows back, not a permission error, not another tenant's row.

## 6. How write confirmation works

```
READ tool                          WRITE tool (mutating + requiresConfirmation)
  ↓                                   ↓
authorize (permission check)       authorize (permission check)
  ↓                                   ↓
execute() immediately              INSERT ai_tool_executions
  ↓                                   status = 'pending_confirmation'
INSERT ai_tool_executions             expires_at = now() + 15min
  status = 'executed'                (execute() NOT called)
```

A second, independent request confirms or rejects:

- **Confirm** (`confirmToolExecution`): re-fetches the row (RLS already scopes it to the caller's
  tenant; an explicit `requestedByUserId === ctx.userId` check also scopes it to the proposing
  user, not just anyone in the tenant), rejects if not `pending_confirmation` (→ "double execution"
  test), rejects if past `expiresAt` (→ "expired proposal" test, and the row is marked `expired`),
  re-runs the permission check fresh, and only then calls `tool.execute()`, recording
  `output`/`error`/`status` and `confirmedByUserId`/`confirmedAt`.
- **Reject** (`rejectToolExecution`): marks the row `rejected`. Never calls `execute()`.

For this initial slice, **every mutating Forms tool requires confirmation** — including
`reorder_form_fields`, which my own earlier architecture proposal had tagged "low-risk, no
confirmation needed." I deliberately overrode that here: the brief's Critical Architectural
Constraint #6 ("a mutating AI operation must never silently execute simply because an LLM
requested it") reads as a blanket rule for this first, unproven pass, and erring toward the
stricter default costs nothing at this stage — a future pass can selectively relax it per-tool,
never the reverse.

## 7. How MCP will eventually plug into the tool registry

Not built in this pass (explicitly deferred). The shape it will take, given what exists now:

```
apps/api/src/ai/tool-registry.ts   ←── same registry, unchanged
        ▲                    ▲
        │                    │
  ai/routes.ts          (future) mcp/server.ts
  (in-app chat)          (external agents, OAuth-scoped)
```

An MCP server would resolve an external agent's identity to a `ToolContext` the same way
`ai/tool-context.ts` does for a web session today — from a server-validated token (not a client
payload), landing on the same `request.tenantDb`-shaped RLS boundary. It would call `getTool()`/
the same `invokeTool`/`confirmToolExecution` functions in `ai/execution-state-machine.ts` — no
second implementation of "create a form field" for MCP to maintain. The propose → confirm flow
already built here is exactly what an MCP write tool needs, too: an external agent proposes, and a
human (in the LMS's own AI Activity UI, built in Phase 2 below) confirms — proven directly by an
integration test (`tests/integration/ai-foundation-security-phase2.test.ts`, "MCP preparation"
describe block) that proposes a change by calling `invokeTool` directly — never through the chat
endpoint — and confirms it through the plain `POST /ai/tool-executions/:id/confirm` route, exactly
as a future MCP-triggered proposal would be confirmed by a human today.

---

## 8. Phase 2 — from API-only foundation to a real tenant-admin experience

Phase 1 (Sections 1–7 above) shipped `apps/api/src/ai/*` with no frontend — every scenario was
proven through `server.inject(...)` integration tests. Phase 2 added the pieces needed for a real
tenant admin to actually use it, without changing any of the security properties above.

### 8.1 New backend surface

- **`GET /ai/conversations`** — this user's own conversations, most recent first (capped at 50).
- **`GET /ai/conversations/:id`** — one conversation's full transcript, each message paired with
  its linked `ai_tool_executions` row when it has one (so a still-`pending_confirmation` proposal
  renders identically whether the user is looking at it for the first time or returning to it
  later — see 8.4).
- **`GET /ai/tool-executions?status=`** — this user's tool-call audit log, optionally filtered by
  status. Backs both "pending confirmation recovery" and the AI Activity page's history list.
- **`ai_conversations.updatedAt`** now bumps on every new message, so the "most recent" ordering
  `GET /ai/conversations` relies on reflects actual activity, not just creation time.
- **`rejectToolExecution` now returns the updated row** (previously `void`) — the frontend needs
  the resolved status to update its own local state without a refetch; this changed the function's
  TypeScript signature but not its authorization/ownership logic (see Section 6's confirm/reject
  description, unchanged).

All three new GET routes reuse `buildToolContext(request)` and scope every query by
`ctx.userId` — same per-user ownership model as `confirmToolExecution`/`rejectToolExecution`
already used. There is no tenant-wide "see everyone's AI activity" endpoint — a deliberate scope
decision, not an oversight: building one would need a new permission key (nothing in the existing
RBAC catalog distinguishes "can see your own AI activity" from "can see the whole tenant's"), and
introducing one wasn't asked for in Phase 2's brief. `apps/api/src/ai/routes.ts`'s own comments
mark this explicitly.

### 8.2 Contextual AI (Forms only)

`POST /ai/conversations/:id/messages` now accepts an optional `context: { formKey?: string }` in
its body. `buildSystemPrompt(context)` folds it into that turn's system prompt as a plain sentence
("The user is currently viewing the X form...") — nothing more. It is never persisted to
`ai_messages`, never passed to a tool as an argument, and never consulted by
`ai/execution-state-machine.ts`'s `authorize()`. The "context spoofing resistance" tests in
`ai-foundation-security-phase2.test.ts` prove this directly: a request carrying a `context` object
with a fabricated `tenantId`/`isSuperAdmin` produces the exact same outcome as a request with no
context at all, because nothing downstream of `buildSystemPrompt` ever reads it.

Frontend counterpart: `apps/web/app/_shared/ai-assistant/ai-page-context.tsx`'s
`AiPageContextProvider`/`useAiPageContext` — a narrowly-scoped React context (mirroring
`lib/subdomain-context.tsx`'s existing pattern), currently provided by exactly one page
(`app/settings/forms/[formKey]/tenant-form-builder-client.tsx`, the Forms Builder workspace) and
read by `AiAssistantLauncher` to attach `{ formKey }` to outgoing messages sent from that page.

### 8.3 The chat UI

`apps/web/app/_shared/ai-assistant/`:

- **`ai-assistant-launcher.tsx`** — a floating trigger + `Drawer` (from `packages/ui`, no new
  primitives), mounted once in `(dashboard-shell)/layout.tsx` (so it's reachable from every page
  in the main tenant app, not tucked into a settings sub-page) and again in the standalone Forms
  Builder page (which renders outside the dashboard shell entirely). On open, it fetches the most
  recent conversation via `GET /ai/conversations` + `GET /ai/conversations/:id` and resumes it;
  "New conversation" starts fresh. Non-streaming: a single request/response per turn, with a
  "Thinking…" loading state — see 8.6 for why streaming wasn't built.
- **`proposal-card.tsx`** — renders a `pending_confirmation` tool execution as an explicit,
  reviewable proposal (what will change, where, whether it's reversible, Confirm/Cancel), and
  renders a resolved execution (executed/rejected/failed/expired) as a compact status line. One
  `describeProposal()` case per mutating Forms tool — deliberately not a generic
  key-value-dump fallback, so what's about to happen is always described in terms a tenant admin
  recognizes, not raw tool-argument JSON.
- **`ai-page-context.tsx`** — Section 8.2.

### 8.4 Pending confirmation recovery

Nothing new architecturally — this falls out of Phase 1's data model for free. A
`pending_confirmation` row in `ai_tool_executions` doesn't disappear when a browser tab closes; the
next time `AiAssistantLauncher` opens (any tab, any time within the session) it re-fetches the
conversation and re-renders the same `ProposalCard`, still actionable. The AI Activity page
(`(dashboard-shell)/settings/ai-activity`) additionally surfaces every `pending_confirmation` row
via `GET /ai/tool-executions?status=pending_confirmation`, independent of which conversation
proposed it — so an admin doesn't need to remember or find the right chat thread to act on
something they asked for earlier.

### 8.5 AI Activity page

`(dashboard-shell)/settings/ai-activity` — a personal history view (Section 8.1's scope note
applies here too), reachable from a new, unconditional "AI Activity" entry under the existing
Settings nav group (`(dashboard-shell)/layout.tsx`). Two sections: pending confirmations (reusing
`ProposalCard` with its Confirm/Cancel buttons live) and history (the same component, rendered in
its read-only compact form for anything already resolved).

### 8.6 Known gaps in this pass

- **No token-level streaming.** `ai/provider/*`'s `streamChat`/`invokeAiStream` exist but
  `ai/routes.ts` doesn't call them — `POST /ai/conversations/:id/messages` is a single
  request/response. The frontend shows a generic "Thinking…" state rather than incremental text.
  Wiring real SSE/streaming end-to-end (Fastify streaming response + a frontend event-stream
  reader) is a reasonable next increment, not done here to keep this phase's scope to "prove the
  loop," per the brief.
- **Only the first tool call in a model turn is acted on** (unchanged from Phase 1) — still true,
  still documented in `ai/routes.ts` itself.
- **No live-provider validation was performed as part of this document's own authorship** — see
  the end-of-phase deliverables report for how provider validation was actually carried out
  (scripted, live, or both) and its results, since that depended on credentials available at task
  time, not on anything this document controls.
