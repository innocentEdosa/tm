import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import { superAdmins, superAdminSessions } from "../db/schema/super-admins";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./password";
import { generateSessionToken, hashSessionToken, sessionExpiryFromNow } from "./session";
import { parseCookie, serializeSuperAdminCookie, SUPER_ADMIN_COOKIE_NAME } from "./cookies";
import { requireSuperAdminSession } from "./require-super-admin-session";

const GENERIC_INVALID_CREDENTIALS = { success: false, message: "Invalid email or password" };
const FAILED_LOGIN_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/** contracts/platform-auth-api.md — none of these routes use `request.tenantDb`; they run against
 * `fastify.db` (platform-level, no RLS on either table — data-model.md). */
const platformAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: { email?: string; password?: string } }>(
    "/platform/login",
    async (request, reply) => {
      const email = request.body?.email?.trim().toLowerCase();
      const password = request.body?.password;
      if (!email || !password) {
        return reply.code(401).send(GENERIC_INVALID_CREDENTIALS);
      }

      const [account] = await fastify.db
        .select({
          id: superAdmins.id,
          email: superAdmins.email,
          name: superAdmins.name,
          passwordHash: superAdmins.passwordHash,
          failedLoginCount: superAdmins.failedLoginCount,
          lockedUntil: superAdmins.lockedUntil,
        })
        .from(superAdmins)
        .where(eq(superAdmins.email, email));

      if (!account) {
        // Timing-equalization (research.md §9): run a dummy verification so response timing
        // doesn't distinguish "unknown email" from "wrong password" (FR-008, SC-003). Rate-limiting
        // has nothing to attach to for an email with no row — that's expected (research.md §9).
        await verifyPassword(password, DUMMY_PASSWORD_HASH);
        return reply.code(401).send(GENERIC_INVALID_CREDENTIALS);
      }

      if (account.lockedUntil && account.lockedUntil > new Date()) {
        const minutesRemaining = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60_000);
        return reply.code(429).send({
          success: false,
          message: `Too many failed attempts. Try again in ${minutesRemaining} minutes.`,
        });
      }

      const passwordValid = await verifyPassword(password, account.passwordHash);
      if (!passwordValid) {
        const newFailedCount = account.failedLoginCount + 1;
        const reachedThreshold = newFailedCount >= FAILED_LOGIN_THRESHOLD;
        await fastify.db
          .update(superAdmins)
          .set({
            failedLoginCount: newFailedCount,
            lockedUntil: reachedThreshold ? new Date(Date.now() + LOCKOUT_DURATION_MS) : account.lockedUntil,
          })
          .where(eq(superAdmins.id, account.id));
        return reply.code(401).send(GENERIC_INVALID_CREDENTIALS);
      }

      const token = generateSessionToken();
      await fastify.db.insert(superAdminSessions).values({
        superAdminId: account.id,
        tokenHash: hashSessionToken(token),
        expiresAt: sessionExpiryFromNow(),
      });
      await fastify.db
        .update(superAdmins)
        .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
        .where(eq(superAdmins.id, account.id));

      reply.header("set-cookie", serializeSuperAdminCookie(token, 8 * 60 * 60));
      return reply.code(200).send({
        success: true,
        data: { id: account.id, email: account.email, name: account.name },
      });
    },
  );

  fastify.get(
    "/platform/me",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const [account] = await fastify.db
        .select({
          id: superAdmins.id,
          email: superAdmins.email,
          name: superAdmins.name,
          lastLoginAt: superAdmins.lastLoginAt,
        })
        .from(superAdmins)
        .where(eq(superAdmins.id, request.superAdmin!.id));

      const flagResult = await request.superAdminDb!.execute(
        sql`SELECT current_setting('app.is_super_admin', true) AS flag`,
      );
      const isSuperAdminFlagSet = (flagResult.rows[0] as { flag: string }).flag === "true";

      return {
        success: true,
        data: {
          id: account.id,
          email: account.email,
          name: account.name,
          lastLoginAt: account.lastLoginAt,
          isSuperAdminFlagSet,
        },
      };
    },
  );

  fastify.post(
    "/platform/logout",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const token = parseCookie(request.headers.cookie, SUPER_ADMIN_COOKIE_NAME);
      if (token) {
        await fastify.db
          .update(superAdminSessions)
          .set({ revokedAt: new Date() })
          .where(eq(superAdminSessions.tokenHash, hashSessionToken(token)));
      }
      reply.header("set-cookie", serializeSuperAdminCookie("", 0));
      return reply.code(204).send();
    },
  );
};

export default platformAuthRoutes;
