import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "./require-permission";

/**
 * Exercises the enforcement pattern (tenant-context + requirePermission) end-to-end ahead of any
 * real business feature depending on it. Not a real business endpoint.
 */
const demoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/_internal/protected-demo",
    { preHandler: [requirePermission("approve_enrollment")] },
    async () => ({ success: true }),
  );
};

export default demoRoutes;
