import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import postgres from "@fastify/postgres";
import { createDb } from "./db/client";
import tenantContext from "./plugins/tenant-context";
import adminRoutes from "./permissions/admin-routes";
import demoRoutes from "./permissions/demo-routes";
import tenantRoleRoutes from "./permissions/tenant-role-routes";

export interface BuildServerOptions {
  /**
   * Test-only seam. No auth mechanism exists yet — research.md §3 explicitly assumes a future
   * auth plugin decorates `request.user` from the server-verified session. Integration tests use
   * this to set `request.user` from a trusted test fixture (never a client-supplied header) before
   * the tenant-context plugin reads it — never passed in production.
   */
  registerAuthStub?: (server: FastifyInstance) => void;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await server.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  // Connects as the restricted `tm_app` (or equivalent) role — never DATABASE_URL, which is the
  // migration/owner role. See drizzle/README.md and apps/api/.env.example.
  await server.register(postgres, {
    connectionString: process.env.APP_DATABASE_URL,
    max: 10,
  });

  server.decorate("db", createDb(server));

  options.registerAuthStub?.(server);

  // DEV-ONLY AUTH STUB — no real auth mechanism exists yet (research.md §3's explicit assumption;
  // a future auth spec will replace this). Gated strictly on NODE_ENV === "development" so it can
  // never activate in staging/production. Lets you manually exercise any route locally by setting
  // `x-dev-user-id`/`x-dev-tenant-id` headers for a user already seeded in `user_roles`. Delete
  // this block once real auth ships.
  if (process.env.NODE_ENV === "development") {
    server.addHook("onRequest", async (request) => {
      const userId = request.headers["x-dev-user-id"];
      if (typeof userId === "string") {
        const tenantId = request.headers["x-dev-tenant-id"];
        request.user = { id: userId, tenantId: typeof tenantId === "string" ? tenantId : "" };
      }
    });
  }

  await server.register(tenantContext);
  await server.register(adminRoutes);
  await server.register(demoRoutes);
  await server.register(tenantRoleRoutes);

  server.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  return server;
}
