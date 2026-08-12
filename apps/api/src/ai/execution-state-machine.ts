import { eq } from "drizzle-orm";
import type { ToolContext } from "./types";
import { getTool } from "./tool-registry";
import { userHasAnyPermission } from "../permissions/require-permission";
import { aiToolExecutions } from "../db/schema/ai";

/**
 * AI Foundation Phase 4 — the READ → authorize → execute → audit / WRITE → authorize → propose →
 * pending_confirmation → confirm → execute → audit state machine. This module is the ONLY code
 * path that ever calls a registered tool's `execute()` — the chat loop (`ai/routes.ts`) and,
 * later, MCP both go through `invokeTool`/`confirmToolExecution`, never around them.
 */

const PROPOSAL_TTL_MS = 15 * 60 * 1000;

export class ToolNotFoundError extends Error {}
export class ToolPermissionDeniedError extends Error {}
export class ToolInputInvalidError extends Error {
  constructor(public readonly issues: unknown) {
    super("Invalid tool input");
  }
}
export class ToolAlreadyResolvedError extends Error {}
export class ToolExpiredError extends Error {}

export interface ToolInvocationResult {
  executionId: string;
  status: "executed" | "pending_confirmation" | "failed";
  output?: unknown;
  error?: string;
}

/** Reuses `userHasAnyPermission` verbatim — the exact same RLS-scoped, RBAC-table join every HTTP
 * route's `requirePermission`/`requireAnyPermission` preHandler already runs
 * (permissions/require-permission.ts). A tool never introduces a parallel permission concept.
 * Empty `requiredPermissions` means "any authenticated session is enough," mirroring routes like
 * `GET /tenant/form-fields` that are intentionally open to any tenant session. */
async function authorize(tool: { requiredPermissions: string[] }, ctx: ToolContext): Promise<boolean> {
  if (tool.requiredPermissions.length === 0) return true;
  return userHasAnyPermission(ctx.db, ctx.userId, tool.requiredPermissions);
}

async function runAndAudit(
  toolName: string,
  tool: { execute(ctx: ToolContext, input: unknown): Promise<unknown>; mutating: boolean; requiredPermissions: string[] },
  ctx: ToolContext,
  input: unknown,
  conversationId: string,
): Promise<ToolInvocationResult> {
  let output: unknown;
  let status: "executed" | "failed" = "executed";
  let error: string | undefined;
  try {
    output = await tool.execute({ ...ctx, conversationId }, input);
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  const [row] = await ctx.db
    .insert(aiToolExecutions)
    .values({
      conversationId,
      tenantId: ctx.tenantId,
      requestedByUserId: ctx.userId,
      confirmedByUserId: ctx.userId,
      toolName,
      input: input as object,
      output: (output ?? null) as object | null,
      status,
      mutating: tool.mutating,
      permissionChecked: tool.requiredPermissions,
      error: error ?? null,
      confirmedAt: new Date(),
    })
    .returning({ id: aiToolExecutions.id });

  return { executionId: row.id, status, output, error };
}

/**
 * The single entry point for invoking a registered tool by name, given an already-resolved
 * `ToolContext` and the raw (unvalidated) input a model produced. Read tools, and any mutating
 * tool explicitly marked `requiresConfirmation: false`, execute and are audited in one step. Every
 * other mutating tool is recorded as a `pending_confirmation` proposal and NEVER executed here —
 * only `confirmToolExecution` below can advance it.
 */
export async function invokeTool(toolName: string, ctx: ToolContext, rawInput: unknown, conversationId: string): Promise<ToolInvocationResult> {
  const tool = getTool(toolName);
  if (!tool) {
    throw new ToolNotFoundError(`Unknown tool "${toolName}"`);
  }

  if (!(await authorize(tool, ctx))) {
    throw new ToolPermissionDeniedError(`Missing required permission for "${toolName}"`);
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolInputInvalidError(parsed.error.issues);
  }

  if (!tool.mutating || !tool.requiresConfirmation) {
    return runAndAudit(toolName, tool, ctx, parsed.data, conversationId);
  }

  const [row] = await ctx.db
    .insert(aiToolExecutions)
    .values({
      conversationId,
      tenantId: ctx.tenantId,
      requestedByUserId: ctx.userId,
      toolName,
      input: parsed.data as object,
      status: "pending_confirmation",
      mutating: true,
      permissionChecked: tool.requiredPermissions,
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
    })
    .returning({ id: aiToolExecutions.id });

  return { executionId: row.id, status: "pending_confirmation" };
}

/**
 * Confirms a pending proposal. Independently re-derives everything from `ctx` (the confirming
 * request's own resolved session) and the persisted row — never trusts anything about the
 * original proposing request beyond the row's own stored `input`:
 *
 * - tenant ownership: the row lookup runs through `ctx.db` (RLS-bound to `ctx.tenantId`), so a
 *   cross-tenant execution id simply doesn't exist from this caller's point of view (same
 *   RLS-does-the-scoping pattern `userHasAnyPermission` already relies on) — never an explicit
 *   `row.tenantId === ctx.tenantId` check, for the same reason none of the existing permission
 *   helpers add one.
 * - not already resolved: `status` must still be `pending_confirmation`.
 * - not expired: `expiresAt` checked against `now()`.
 * - permission re-checked fresh, not copied from the proposal (a role change between propose and
 *   confirm must take effect).
 */
export async function confirmToolExecution(executionId: string, ctx: ToolContext): Promise<ToolInvocationResult> {
  const [row] = await ctx.db.select().from(aiToolExecutions).where(eq(aiToolExecutions.id, executionId));
  // Not-found, not forbidden, for a row belonging to another user — same "don't confirm a
  // cross-tenant id exists" reasoning extended to cross-user within one tenant (a proposal is the
  // requesting user's own, not shared tenant-wide, in this first slice).
  if (!row || row.requestedByUserId !== ctx.userId) {
    throw new ToolNotFoundError("Unknown tool execution");
  }
  if (row.status !== "pending_confirmation") {
    throw new ToolAlreadyResolvedError(`This action is already "${row.status}" and cannot be confirmed again.`);
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    await ctx.db.update(aiToolExecutions).set({ status: "expired" }).where(eq(aiToolExecutions.id, executionId));
    throw new ToolExpiredError("This proposal has expired. Ask again to generate a fresh one.");
  }

  const tool = getTool(row.toolName);
  if (!tool) {
    throw new ToolNotFoundError(`Unknown tool "${row.toolName}"`);
  }
  if (!(await authorize(tool, ctx))) {
    throw new ToolPermissionDeniedError(`You no longer have permission to confirm "${row.toolName}".`);
  }

  let output: unknown;
  let status: "executed" | "failed" = "executed";
  let error: string | undefined;
  try {
    output = await tool.execute({ ...ctx, conversationId: row.conversationId }, row.input);
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  await ctx.db
    .update(aiToolExecutions)
    .set({ status, output: (output ?? null) as object | null, error: error ?? null, confirmedByUserId: ctx.userId, confirmedAt: new Date() })
    .where(eq(aiToolExecutions.id, executionId));

  return { executionId, status, output, error };
}

export async function rejectToolExecution(executionId: string, ctx: ToolContext): Promise<typeof aiToolExecutions.$inferSelect> {
  const [row] = await ctx.db.select().from(aiToolExecutions).where(eq(aiToolExecutions.id, executionId));
  if (!row || row.requestedByUserId !== ctx.userId) {
    throw new ToolNotFoundError("Unknown tool execution");
  }
  if (row.status !== "pending_confirmation") {
    throw new ToolAlreadyResolvedError(`This action is already "${row.status}" and cannot be rejected.`);
  }
  const [updated] = await ctx.db
    .update(aiToolExecutions)
    .set({ status: "rejected", confirmedByUserId: ctx.userId, confirmedAt: new Date() })
    .where(eq(aiToolExecutions.id, executionId))
    .returning();
  return updated;
}
