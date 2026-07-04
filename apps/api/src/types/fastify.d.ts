import type { Db } from "../db/client";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }

  interface FastifyRequest {
    /**
     * Decorated by tenant-auth/tenant-user-context.ts (Tenant Authentication Configuration spec)
     * from a validated `user_sessions` lookup — never trusts a client-supplied header/body value for
     * tenantId (research.md §3, constitution Principle I).
     */
    user?: {
      id: string;
      tenantId: string;
    };
    /**
     * True while the authenticated user still has a one-time password active (Tenant Authentication
     * Configuration spec FR-013a) — only set alongside `request.user`. Guarded routes other than
     * `POST /tenant-auth/set-password` must reject while this is true.
     */
    mustChangePassword?: boolean;
    /**
     * Drizzle instance bound to this request's transaction-scoped client, with
     * `SET LOCAL app.tenant_id` already applied — see plugins/tenant-context.ts.
     */
    tenantDb: Db;
    /**
     * Decorated by platform-auth/super-admin-context.ts from a validated `super_admin_sessions`
     * lookup only — never from client-supplied input (spec FR-012).
     */
    superAdmin?: {
      id: string;
      email: string;
      name: string;
    };
    /**
     * Drizzle instance bound to this request's transaction-scoped client, with
     * `SET LOCAL app.is_super_admin` already applied — see platform-auth/super-admin-context.ts.
     */
    superAdminDb?: Db;
  }
}
