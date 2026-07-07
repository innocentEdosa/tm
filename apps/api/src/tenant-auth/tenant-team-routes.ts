import type { FastifyPluginAsync } from "fastify";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { requireTenantUserSession } from "./require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { resolveTeamVisibilityScope } from "./team-visibility";
import { collectSubtreeIds } from "../departments/department-hierarchy";
import { users } from "../db/schema/users";
import { userRoles, roles, rolePermissions } from "../db/schema/roles";
import { departments } from "../db/schema/departments";
import { permissions } from "../db/schema/permissions";
import { generateOneTimePassword, otpExpiryFromNow } from "./otp";
import { hashPassword } from "../platform-auth/password";
import { sendOneTimePasswordEmail } from "./mailer";

const DEFAULT_PAGE_SIZE = 25;
const inviter = alias(users, "inviter");

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/** contracts/tenant-auth-api.md. Deliberately minimal (spec Assumptions/FR-018): creates the
 * account immediately with a one-time password — no pending-invitation record, list, resend, or
 * revoke mechanism. */
const tenantTeamRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tenant/team — spec 012 (Team Member Directory), FR-001/FR-002/FR-003/FR-008/FR-009/FR-012.
  // Visibility is enforced entirely server-side via team-visibility.ts, never a client-side filter of
  // an already-fetched list (spec's own constraint).
  fastify.get<{ Querystring: { search?: string; departmentId?: string; page?: string; pageSize?: string } }>(
    "/tenant/team",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("team.view.all", "team.view.department"),
      ],
    },
    async (request) => {
      const tenantId = request.user!.tenantId;
      const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
      const pageSize = Math.max(1, parseInt(request.query.pageSize ?? "", 10) || DEFAULT_PAGE_SIZE);

      const [viewAllGrant] = await request.tenantDb
        .select({ id: permissions.id })
        .from(userRoles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(and(eq(userRoles.userId, request.user!.id), eq(permissions.key, "team.view.all")));

      const scope = await resolveTeamVisibilityScope(request.tenantDb, request.user!.id, !!viewAllGrant);

      if (scope.kind === "no_department_assigned") {
        return { success: true, data: [], meta: { page, pageSize, total: 0, reason: "no_department_assigned" } };
      }

      let effectiveDepartmentIds: string[] | null = scope.kind === "department" ? scope.departmentIds : null;
      if (scope.kind === "all" && request.query.departmentId) {
        effectiveDepartmentIds = await collectSubtreeIds(request.tenantDb, request.query.departmentId);
      }

      const conditions = [eq(users.tenantId, tenantId)];
      if (effectiveDepartmentIds) {
        conditions.push(inArray(users.departmentId, effectiveDepartmentIds));
      }
      if (request.query.search) {
        const term = `%${request.query.search}%`;
        conditions.push(or(ilike(users.fullName, term), ilike(users.email, term))!);
      }

      const [{ count: total }] = await request.tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(...conditions));

      const rows = await request.tenantDb
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          mustChangePassword: users.mustChangePassword,
          departmentName: departments.name,
          roleName: roles.name,
          invitedByName: inviter.fullName,
          invitedAt: users.createdAt,
        })
        .from(users)
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .leftJoin(inviter, eq(inviter.id, users.invitedBy))
        .where(and(...conditions))
        .orderBy(users.fullName)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const data = rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        roleName: row.roleName,
        departmentName: row.departmentName,
        accountStatus: row.mustChangePassword ? "invited" : "active",
        invitedByName: row.invitedByName,
        invitedAt: row.invitedAt,
      }));

      return { success: true, data, meta: { page, pageSize, total, reason: null } };
    },
  );

  fastify.post<{ Body: { fullName?: string; email?: string; roleId?: string; departmentId?: string } }>(
    "/tenant-auth/team",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("manage_team_members", "team.create"),
      ],
    },
    async (request, reply) => {
      const { fullName, email, roleId, departmentId } = request.body ?? {};
      if (!fullName || !email || !roleId) {
        return reply.code(400).send({ success: false, message: "fullName, email, and roleId are required" });
      }

      const tenantId = request.user!.tenantId;

      // User Story 4 (Department Management spec 009, FR-010) — only an Active department in the
      // caller's own tenant may be assigned; RLS already scopes this lookup, and the `active` filter
      // keeps a client from assigning into an archived department via a direct API call.
      if (departmentId) {
        const [dept] = await request.tenantDb
          .select({ id: departments.id })
          .from(departments)
          .where(and(eq(departments.id, departmentId), eq(departments.status, "active")));
        if (!dept) {
          return reply.code(422).send({ success: false, message: "Department not found or not active" });
        }
      }

      const oneTimePassword = generateOneTimePassword();

      let createdUser: { id: string; email: string };
      try {
        [createdUser] = await request.tenantDb
          .insert(users)
          .values({
            tenantId,
            fullName,
            email: email.trim().toLowerCase(),
            passwordHash: await hashPassword(oneTimePassword),
            mustChangePassword: true,
            otpExpiresAt: otpExpiryFromNow(),
            departmentId: departmentId ?? null,
            invitedBy: request.user!.id,
          })
          .returning({ id: users.id, email: users.email });
      } catch (err) {
        if (pgErrorCode(err) === "23505") {
          // FR-020: rejected only at the SAME tenant — the unique constraint is (tenant_id, email),
          // so the same email at a different tenant is unaffected and would succeed there.
          return reply.code(409).send({ success: false, message: "Email already in use at this tenant" });
        }
        throw err;
      }

      await request.tenantDb.insert(userRoles).values({ tenantId, userId: createdUser.id, roleId });

      try {
        await sendOneTimePasswordEmail(createdUser.email, oneTimePassword);
      } catch (err) {
        request.log.error(err, "Failed to send team-member one-time-password email");
      }

      return reply.code(201).send({ success: true, data: { id: createdUser.id, email: createdUser.email } });
    },
  );
};

export default tenantTeamRoutes;
