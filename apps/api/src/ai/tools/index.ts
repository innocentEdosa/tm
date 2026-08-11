/**
 * Side-effect import barrel — every tool module registers itself with `ai/tool-registry.ts` at
 * import time. `ai/routes.ts` imports this once so the registry is populated before any request
 * needs it. Add a new domain's tool module's import here, not a new registration call site.
 */
import "./forms";
