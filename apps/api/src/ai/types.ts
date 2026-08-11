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
  /** Shown to the model verbatim — describe what the tool does and when to use it in plain
   * language, not implementation detail. */
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
  execute(context: ToolContext, input: TInput): Promise<TOutput>;
}
