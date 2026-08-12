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

/** Composes the exact string sent to a provider as a tool's `description` (Tool Selection & Scope
 * Guardrails phase) — a `[domain → resource.operation]` tag prepended to the tool's own prose. Pure
 * and provider-independent: both `AnthropicProvider` and `OpenAiProvider` just receive whatever
 * string `ai/routes.ts` puts in `ChatToolSpec.description`, unaware this composition happened at
 * all. The tag exists so a model can tell two structurally-similar tools apart from different
 * domains (e.g. `update_form_field` vs a future `update_course_lesson`) without depending on prose
 * alone — see `ai/routes.ts`'s `SYSTEM_PROMPT` for the matching instruction that tells the model how
 * to use this tag when deciding whether any registered tool actually applies. */
export function describeToolForProvider(tool: AiToolDefinition<any, any>): string {
  return `[${tool.domain} → ${tool.resource}.${tool.operation}] ${tool.description}`;
}

/** Test-only seam — lets integration tests reset the registry between runs if a test needs to
 * register a throwaway tool. Never called from production code. */
export function __clearRegistryForTesting(): void {
  registry.clear();
}
