import type { FastifyPluginAsync } from "fastify";
import { resolveTenantBySubdomain } from "./resolve-tenant";

/** contracts/tenant-routing-resolve-api.md — public, unauthenticated (not tenant-confidential data,
 * spec 004). Called server-to-server by apps/web/middleware.ts, never through the browser-facing
 * `/platform-api/*` rewrite proxy (research.md §5). */
const tenantRoutingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { subdomain?: string } }>(
    "/tenant-routing/resolve",
    async (request, reply) => {
      const subdomain = request.query.subdomain;
      if (!subdomain || subdomain.includes(".") || subdomain.trim() === "") {
        return reply.code(400).send({ success: false, message: "Invalid subdomain" });
      }

      const result = await resolveTenantBySubdomain(fastify.pg.pool, subdomain);
      return reply.code(200).send({ success: true, data: result });
    },
  );
};

export default tenantRoutingRoutes;
