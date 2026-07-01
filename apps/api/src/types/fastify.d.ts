import type { Db } from "../db/client";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }

  interface FastifyRequest {
    /**
     * Decorated by the (future) auth mechanism — assumed to already exist, never trusts a
     * client-supplied header/body value for tenantId (research.md §3, constitution Principle I).
     */
    user?: {
      id: string;
      tenantId: string;
    };
    /**
     * Drizzle instance bound to this request's transaction-scoped client, with
     * `SET LOCAL app.tenant_id` already applied — see plugins/tenant-context.ts.
     */
    tenantDb: Db;
  }
}
