import type { ZodType } from "zod";
import type { Db } from "../db/client";

/**
 * The context every AI tool executes with — the AI-layer counterpart of `request.user` +
 * `request.tenantDb` (plugins/tenant-context.ts). Built exactly once per request, server-side,
 * from the same validated tenant-user session every existing route already trusts
 * (tenant-auth/tenant-user-context.ts) — see `ai/tool-context.ts`.
 *
 * MUST NEVER be constructed from tool input, prompt text, or LLM output. `tenantId` in particular
 * is never accepted as a tool argument anywhere in this module (AI Foundation, Critical
 * Architectural Constraint #2) — a tool's `inputSchema` must never include a `tenantId` field, and
 * `execute()` must never read one off `input`.
 */
export interface ToolContext {
  tenantId: string;
  userId: string;
  /** RLS-bound Drizzle instance for this request's transaction (`request.tenantDb`) — the only
   * database handle a tool implementation may use. Never the pool-wide `fastify.db`. */
  db: Db;
  /** AI Image Discovery & Course Asset Management Phase 1 — added so a tool's own `execute()` can
   * look up OTHER executions in the same conversation (e.g. `set_course_image` verifying its
   * `providerImageId` came from a real, recent `search_course_images` result — see
   * `ai/tools/images.ts`'s `resolveCandidateFromRecentSearches`). Always populated by
   * `execution-state-machine.ts` — the only place `execute()` is ever called from — never sourced
   * from tool input. Optional only so a hand-built `ToolContext` in a test/future non-conversation
   * caller (a tool with no conversation concept at all) isn't forced to invent one. */
  conversationId?: string;
}

export type ToolScope = "tenant" | "platform";

/**
 * The stable contract every AI tool implements (AI Foundation Phase 2) — deliberately small.
 * Wraps an `apps/api/src/**` application service (never the database directly, never duplicated
 * business logic) so the exact same tool definition can later be driven by three different
 * callers: the in-app AI conversation loop (Phase 6), a future MCP server (Phase 9+), and any
 * other future automation surface — all three call `execute()` through this one registry, never
 * around it.
 */
export interface AiToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Stable, machine-addressable identifier (e.g. `"create_form_field"`) — also the name surfaced
   * to the model for tool-calling, so keep it short and descriptive. */
  name: string;
  /** Machine-checkable identity for this tool (Tool Selection & Scope Guardrails phase) — NOT just
   * documentation. `ai/tool-registry.ts`'s `describeToolForProvider` composes a
   * `[domain → resource.operation]` tag from these three fields onto the front of every tool's
   * provider-facing description, so domain disambiguation is structural and consistent across every
   * tool the model sees, instead of depending on each tool author remembering to spell out "never
   * use this for X" in prose (root cause of `update_form_field` once being selected for a course
   * lesson request — see that phase's audit). Generic across every current and future domain, not
   * Course- or Forms-specific: `domain` groups tools by LMS area ("forms", "courses", eventually
   * "analytics"/"departments"/"users"/"assignments"), `resource` names the entity a tool acts on
   * within that domain ("field", "lesson", "module"), `operation` names what it does to that
   * resource. `operation` is conventionally one of list/get/create/update/delete/reorder/suggest but
   * deliberately typed as a plain string, not a closed union — constraining it up front to today's
   * verbs would be exactly the kind of speculative rigidity that breaks the first time a domain
   * needs a verb this list didn't anticipate. */
  domain: string;
  resource: string;
  operation: string;
  /** Shown to the model verbatim (with the `[domain → resource.operation]` tag prepended at send
   * time, never stored here) — describe what the tool does and when to use it in plain language, not
   * implementation detail. */
  description: string;
  inputSchema: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>;
  /** Checked with the exact same `userHasAnyPermission` (permissions/require-permission.ts) every
   * HTTP route already uses — a tool never introduces a parallel permission concept. Empty array
   * means "any authenticated tenant session," mirroring existing routes like
   * `GET /tenant/form-fields` that are intentionally open to any session (the entity's own screen
   * gates access, not a forms-specific permission). */
  requiredPermissions: string[];
  /** Read tools execute immediately once authorized. Mutating tools always go through the
   * propose → confirm state machine (ai/execution-state-machine.ts) — `execute()` for a mutating
   * tool is only ever invoked once, at confirmation time, never directly from a chat turn. */
  mutating: boolean;
  /** For this initial foundation, every mutating tool requires confirmation (Critical
   * Architectural Constraint #6 — "a mutating AI operation must never silently execute simply
   * because an LLM requested it"); this flag exists so a future, individually-reviewed tool can
   * deviate deliberately rather than by omission. Read tools must set this to `false`. */
  requiresConfirmation: boolean;
  /** `"tenant"` tools receive a tenant-scoped `ToolContext.db` (`request.tenantDb`); `"platform"`
   * tools (none implemented yet — Phase 8 explicitly defers platform-wide AI) would receive a
   * super-admin-scoped context instead. Declared now so the registry/executor can branch on it
   * later without a breaking change to this contract. */
  scope: ToolScope;
  /** Optional, tool-specific override for the propose-time assistant message
   * (`ai/routes.ts`'s otherwise-generic "I'd like to X. Review the proposed change below..." line).
   * Course Generation Phase 1: a proposal this rich (a whole nested course/modules/lessons plan) has
   * no other "real" source data a later refinement turn could re-derive it from the way, say, a
   * reorder proposal can re-derive the current order from an earlier `list_course_modules` read
   * result — the proposal's OWN prior input is the only record of it. `reconstructHistory` never
   * attaches a structured tool-result for a still-`pending_confirmation` execution (by design — see
   * that module's own doc comment), but it always replays a mutating tool's saved propose-time
   * message text verbatim on every later turn. So a tool that needs a human's (and the model's own)
   * multi-turn "what did I just propose" question answerable defines this to make that text the full
   * structure instead of the generic one-liner — no change to `reconstruct-history.ts` or
   * `execution-state-machine.ts` needed. Most tools should leave this undefined. */
  summarizeProposal?(input: TInput): string;
  execute(context: ToolContext, input: TInput): Promise<TOutput>;
}
