import type { FastifyRequest } from "fastify";
import type { ToolContext } from "./types";

/**
 * Builds a `ToolContext` from the exact same server-verified session data every existing route
 * already trusts — `request.user` (tenant-auth/tenant-user-context.ts) and `request.tenantDb`
 * (plugins/tenant-context.ts). This is the ONLY place a `ToolContext` is constructed; there is no
 * other path (never from a request body, tool argument, or MCP payload — AI Foundation Critical
 * Architectural Constraint #2).
 */
export function buildToolContext(request: FastifyRequest): ToolContext {
  if (!request.user) {
    throw new Error("buildToolContext called without an authenticated tenant-user session");
  }
  return { tenantId: request.user.tenantId, userId: request.user.id, db: request.tenantDb };
}
