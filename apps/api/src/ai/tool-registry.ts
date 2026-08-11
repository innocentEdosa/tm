import type { AiToolDefinition } from "./types";

/**
 * The one place every AI tool is registered — the "stable contract that can later be consumed by
 * in-app AI, MCP, and future automation" the AI Foundation calls for. A module-level `Map` (not a
 * class/DI container — this codebase has no DI framework anywhere, so introducing one here would
 * be the "unnecessary abstraction" the brief warns against); tools self-register by calling
 * `registerTool` once at import time (see `ai/tools/forms.ts`'s bottom-of-file calls).
 */
const registry = new Map<string, AiToolDefinition<any, any>>();

export function registerTool(tool: AiToolDefinition<any, any>): void {
  if (registry.has(tool.name)) {
    throw new Error(`AI tool "${tool.name}" is already registered`);
  }
  registry.set(tool.name, tool);
}

export function getTool(name: string): AiToolDefinition<any, any> | undefined {
  return registry.get(name);
}

export function listTools(): AiToolDefinition<any, any>[] {
  return [...registry.values()];
}

/** Test-only seam — lets integration tests reset the registry between runs if a test needs to
 * register a throwaway tool. Never called from production code. */
export function __clearRegistryForTesting(): void {
  registry.clear();
}
