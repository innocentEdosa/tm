import type { FastifyPluginAsync } from "fastify";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { requireTenantUserSession } from "./require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { resolveTeamVisibilityScope } from "./team-visibility";
import { roleExists, departmentIsActive, isDepartmentLeader } from "./team-write-validation";
import { getFormFields } from "../custom-fields/field-key-uniqueness";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";
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
  fastify.get<{
    Querystring: { search?: string; departmentId?: string; page?: string; pageSize?: string; includeArchived?: string };
  }>(
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
      // Archive capability (spec 013, HR feedback round) — archived members are hidden by default;
      // an explicit `includeArchived=true` reveals them (e.g. an "Include archived" toggle).
      if (request.query.includeArchived !== "true") {
        conditions.push(isNull(users.archivedAt));
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
          archivedAt: users.archivedAt,
          departmentId: departments.id,
          departmentName: departments.name,
          roleId: roles.id,
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
        roleId: row.roleId,
        roleName: row.roleName,
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        accountStatus: row.mustChangePassword ? "invited" : "active",
        isArchived: row.archivedAt !== null,
        invitedByName: row.invitedByName,
        invitedAt: row.invitedAt,
      }));

      return { success: true, data, meta: { page, pageSize, total, reason: null } };
    },
  );

  fastify.post<{
    Body: {
      fullName?: string;
      email?: string;
      roleId?: string;
      departmentId?: string;
      customFieldValues?: Record<string, unknown>;
    };
  }>(
    "/tenant-auth/team",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("manage_team_members", "team.create"),
      ],
    },
    async (request, reply) => {
      const { fullName, email, roleId, departmentId, customFieldValues } = request.body ?? {};
      if (!fullName || !email || !roleId) {
        return reply.code(400).send({ success: false, message: "fullName, email, and roleId are required" });
      }

      const tenantId = request.user!.tenantId;

      // Spec 013 (Add/Edit Team Member), research.md §1 — validated before any write: a bad roleId
      // used to reach an uncaught FK violation (a raw 500) only *after* the users row below was
      // already committed, orphaning it with no role at all.
      if (!(await roleExists(request.tenantDb, roleId))) {
        return reply.code(422).send({ success: false, message: "Role not found" });
      }

      // User Story 4 (Department Management spec 009, FR-010) — only an Active department in the
      // caller's own tenant may be assigned; RLS already scopes this lookup, and the `active` filter
      // keeps a client from assigning into an archived department via a direct API call.
      if (departmentId && !(await departmentIsActive(request.tenantDb, departmentId))) {
        return reply.code(422).send({ success: false, message: "Department not found or not active" });
      }

      // Spec 013 US3, research.md §5 — validated before any write, mirroring Department's own
      // established order exactly (validate everything first, write only after all checks pass).
      const fields = customFieldValues ? await getFormFields(request.tenantDb, "member") : [];
      if (customFieldValues) {
        const errors = validateCustomFieldValues(customFieldValues, fields);
        if (errors.length > 0) {
          return reply.code(422).send({ success: false, errors });
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

      if (customFieldValues) {
        await writeCustomFieldValues(request.tenantDb, tenantId, "member", createdUser.id, customFieldValues, fields);
      }

      try {
        await sendOneTimePasswordEmail(createdUser.email, oneTimePassword);
      } catch (err) {
        request.log.error(err, "Failed to send team-member one-time-password email");
      }

      return reply.code(201).send({ success: true, data: { id: createdUser.id, email: createdUser.email } });
    },
  );

  // PATCH /tenant/team/:userId — spec 013 (Add/Edit Team Member) US2, FR-006/FR-007. A capability
  // that did not exist in the product before this spec — editing a member's full name, role, and/or
  // department after invite-time creation. Org-wide only (Clarifications, 2026-07-08) — no
  // department-scoped edit tier.
  fastify.patch<{
    Params: { userId: string };
    Body: {
      fullName?: string;
      roleId?: string;
      departmentId?: string | null;
      customFieldValues?: Record<string, unknown>;
      archived?: boolean;
    };
  }>(
    "/tenant/team/:userId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("manage_team_members", "team.edit"),
      ],
    },
    async (request, reply) => {
      const { userId } = request.params;
      const { fullName, roleId, departmentId, customFieldValues, archived } = request.body ?? {};

      const [existing] = await request.tenantDb.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      // research.md §1 — validated before any write, identical rules to POST.
      if (roleId !== undefined && !(await roleExists(request.tenantDb, roleId))) {
        return reply.code(422).send({ success: false, message: "Role not found" });
      }
      if (departmentId != null && !(await departmentIsActive(request.tenantDb, departmentId))) {
        return reply.code(422).send({ success: false, message: "Department not found or not active" });
      }

      // Archive capability (spec 013, HR feedback round) — a "full soft-delete", validated before
      // any write: never let a caller archive their own account (would lock them out mid-request),
      // and never archive someone still holding a department's Manager/Assistant Manager assignment
      // (that leadership role must be reassigned first, per direct product decision).
      if (archived === true) {
        if (userId === request.user!.id) {
          return reply.code(422).send({ success: false, message: "You cannot archive your own account." });
        }
        if (await isDepartmentLeader(request.tenantDb, userId)) {
          return reply.code(422).send({
            success: false,
            message: "This member is a department Manager or Assistant Manager. Reassign that role before archiving them.",
          });
        }
      }

      // Spec 013 US3, research.md §5 — validated before any write, same order as POST.
      const fields = customFieldValues ? await getFormFields(request.tenantDb, "member") : [];
      if (customFieldValues) {
        const errors = validateCustomFieldValues(customFieldValues, fields);
        if (errors.length > 0) {
          return reply.code(422).send({ success: false, errors });
        }
      }

      if (fullName !== undefined || departmentId !== undefined || archived !== undefined) {
        await request.tenantDb
          .update(users)
          .set({
            ...(fullName !== undefined ? { fullName } : {}),
            ...(departmentId !== undefined ? { departmentId } : {}),
            ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }

      // research.md §2 — a single-row update, preserving the "exactly one role per user" invariant
      // by construction rather than delete+insert.
      if (roleId !== undefined) {
        await request.tenantDb.update(userRoles).set({ roleId }).where(eq(userRoles.userId, userId));
      }

      if (customFieldValues) {
        await writeCustomFieldValues(request.tenantDb, request.user!.tenantId, "member", userId, customFieldValues, fields);
      }

      const [row] = await request.tenantDb
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          mustChangePassword: users.mustChangePassword,
          archivedAt: users.archivedAt,
          departmentId: departments.id,
          departmentName: departments.name,
          roleId: roles.id,
          roleName: roles.name,
          invitedByName: inviter.fullName,
          invitedAt: users.createdAt,
        })
        .from(users)
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .leftJoin(inviter, eq(inviter.id, users.invitedBy))
        .where(eq(users.id, userId));

      return reply.code(200).send({
        success: true,
        data: {
          id: row.id,
          fullName: row.fullName,
          email: row.email,
          roleId: row.roleId,
          roleName: row.roleName,
          departmentId: row.departmentId,
          departmentName: row.departmentName,
          accountStatus: row.mustChangePassword ? "invited" : "active",
          isArchived: row.archivedAt !== null,
          invitedByName: row.invitedByName,
          invitedAt: row.invitedAt,
        },
      });
    },
  );
};

export default tenantTeamRoutes;
