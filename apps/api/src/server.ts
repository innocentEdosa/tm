import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import postgres from "@fastify/postgres";
import { createDb } from "./db/client";
import tenantContext from "./plugins/tenant-context";
import adminRoutes from "./permissions/admin-routes";
import demoRoutes from "./permissions/demo-routes";
import tenantRoleRoutes from "./permissions/tenant-role-routes";
import provisioningRoutes from "./provisioning/provisioning-routes";
import tenantManagementRoutes from "./tenant-management/tenant-management-routes";
import superAdminTenantConsoleRoutes from "./super-admin-tenant-console/super-admin-tenant-console-routes";
import superAdminContext from "./platform-auth/super-admin-context";
import platformAuthRoutes from "./platform-auth/platform-auth-routes";
import tenantRoutingRoutes from "./tenant-routing/tenant-routing-routes";
import tenantUserContext from "./tenant-auth/tenant-user-context";
import tenantAuthSettingsRoutes from "./tenant-auth/tenant-auth-settings-routes";
import tenantAuthRoutes from "./tenant-auth/tenant-auth-routes";
import tenantTeamRoutes from "./tenant-auth/tenant-team-routes";
import tenantDepartmentRoutes from "./departments/tenant-department-routes";
import tenantFormRoutes from "./custom-fields/tenant-form-routes";
import tenantTrainingNeedsRoutes from "./training-needs/tenant-training-needs-routes";
import tenantCourseRoutes from "./courses/tenant-course-routes";
import tenantCourseContentRoutes from "./course-content/tenant-course-content-routes";
import tenantAttachmentRoutes from "./attachments/tenant-attachment-routes";
import tenantProgressRoutes from "./progress/tenant-progress-routes";
import tenantScormUploadRoutes from "./scorm/tenant-scorm-upload-routes";
import tenantScormRuntimeRoutes from "./scorm/tenant-scorm-runtime-routes";

export interface BuildServerOptions {
  /**
   * Test-only seam, kept even though a real tenant-user auth mechanism now exists
   * (tenant-auth/tenant-user-context.ts) — integration tests use this to set `request.user` from a
   * trusted test fixture directly (never a client-supplied header), sidestepping a full
   * OTP/login/session round-trip for tests that only care about tenant-scoping behavior, not login
   * itself. Never passed in production.
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

  // Real tenant-user auth (Tenant Authentication Configuration spec) — decorates request.user from
  // a verified user_sessions row before tenant-context.ts reads it. Superseded and removed the
  // former dev-only `x-dev-user-id`/`x-dev-tenant-id` header stub this comment used to describe.
  await server.register(tenantUserContext);
  await server.register(tenantContext);
  await server.register(superAdminContext);
  await server.register(adminRoutes);
  await server.register(demoRoutes);
  await server.register(tenantRoleRoutes);
  await server.register(provisioningRoutes);
  await server.register(tenantManagementRoutes);
  await server.register(superAdminTenantConsoleRoutes);
  await server.register(platformAuthRoutes);
  await server.register(tenantRoutingRoutes);
  await server.register(tenantAuthSettingsRoutes);
  await server.register(tenantAuthRoutes);
  await server.register(tenantTeamRoutes);
  await server.register(tenantDepartmentRoutes);
  await server.register(tenantFormRoutes);
  await server.register(tenantTrainingNeedsRoutes);
  await server.register(tenantCourseRoutes);
  await server.register(tenantCourseContentRoutes);
  await server.register(tenantAttachmentRoutes);
  await server.register(tenantProgressRoutes);
  await server.register(tenantScormUploadRoutes);
  await server.register(tenantScormRuntimeRoutes);

  server.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  return server;
}
