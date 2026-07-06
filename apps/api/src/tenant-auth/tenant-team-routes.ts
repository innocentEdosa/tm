import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { requireTenantUserSession } from "./require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { users } from "../db/schema/users";
import { userRoles } from "../db/schema/roles";
import { departments } from "../db/schema/departments";
import { generateOneTimePassword, otpExpiryFromNow } from "./otp";
import { hashPassword } from "../platform-auth/password";
import { sendOneTimePasswordEmail } from "./mailer";

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
  fastify.post<{ Body: { fullName?: string; email?: string; roleId?: string; departmentId?: string } }>(
    "/tenant-auth/team",
    { preHandler: [requireTenantUserSession(), requirePermission("manage_team_members")] },
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
