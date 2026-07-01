import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/server";

/**
 * Test-only auth stub: reads `x-test-user-id`/`x-test-tenant-id` headers — trusted ONLY here,
 * because this is the harness standing in for the future auth mechanism research.md §3 assumes
 * (`request.user` decorated from the server-verified session). Runs before tenant-context via
 * `BuildServerOptions.registerAuthStub` (src/server.ts), never via a client-supplied header in
 * production code.
 */
export async function buildTestServer(): Promise<FastifyInstance> {
  return buildServer({
    registerAuthStub(server) {
      server.addHook("onRequest", async (request) => {
        const userId = request.headers["x-test-user-id"];
        const tenantId = request.headers["x-test-tenant-id"];
        if (typeof userId === "string" && typeof tenantId === "string") {
          request.user = { id: userId, tenantId };
        }
      });
    },
  });
}
