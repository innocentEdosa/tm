import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { resolveTenantBySubdomain } from "../tenant-routing/resolve-tenant";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "../platform-auth/password";
import { generateSessionToken, hashSessionToken, sessionExpiryFromNow } from "../platform-auth/session";
import { parseCookie, serializeTenantUserCookie, TENANT_USER_COOKIE_NAME } from "./cookies";
import { requireTenantUserSession } from "./require-tenant-user-session";
import { sendPasswordResetEmail } from "./mailer";
import { resolveEffectivePermissions } from "../permissions/effective-permissions";

type UserRoleRow = {
  user_role_id: string;
  role_name: string;
  permission_key: string | null;
};

const RESET_TOKEN_VALIDITY_MS = 60 * 60 * 1000; // 1 hour

const GENERIC_INVALID_CREDENTIALS = { success: false, message: "Invalid email or password" };
const FAILED_LOGIN_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

interface AuthenticatedUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  archived_at: Date | null;
}

/** contracts/tenant-auth-api.md. `subdomain` is always a query param, never a body field
 * (research.md §4 addendum) — every route here independently re-resolves it via Spec 4's
 * resolveTenantBySubdomain, never trusting it directly as a tenant_id. Runs its own raw
 * BEGIN/COMMIT per request rather than `request.tenantDb`, since these routes are reachable
 * before any session exists (no `request.user` yet for tenant-context.ts to act on). */
const tenantAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Querystring: { subdomain?: string }; Body: { email?: string; password?: string } }>(
    "/tenant-auth/login",
    async (request, reply) => {
      const subdomain = request.query.subdomain;
      const email = request.body?.email?.trim().toLowerCase();
      const password = request.body?.password;
      if (!subdomain || !email || !password) {
        return reply.code(401).send(GENERIC_INVALID_CREDENTIALS);
      }

      const resolved = await resolveTenantBySubdomain(fastify.pg.pool, subdomain);
      if (resolved.state !== "valid" || !resolved.tenantId) {
        return reply.code(401).send(GENERIC_INVALID_CREDENTIALS);
      }
      const tenantId = resolved.tenantId;

      const client = await fastify.pg.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

        const result = await client.query<AuthenticatedUserRow>(
          `SELECT id, email, password_hash, must_change_password, failed_login_count, locked_until, archived_at
           FROM users WHERE tenant_id = $1 AND email = $2`,
          [tenantId, email],
        );
        const account = result.rows[0];

        if (!account) {
          // Timing-equalization (mirrors platform-auth's own precedent): run a dummy verification
          // so response timing doesn't distinguish "unknown email" from "wrong password" (FR-009).
          await verifyPassword(password, DUMMY_PASSWORD_HASH);
          await client.query("COMMIT");
          return reply.code(401).send(GENERIC_INVALID_CREDENTIALS);
        }

        // Spec 013 (archive capability) — an archived account cannot log in at all, mirroring the
        // locked_until check's own pattern (rejected before password verification).
        if (account.archived_at) {
          await client.query("COMMIT");
          return reply.code(401).send({ success: false, message: "This account has been archived." });
        }

        if (account.locked_until && account.locked_until > new Date()) {
          const minutesRemaining = Math.ceil((account.locked_until.getTime() - Date.now()) / 60_000);
          await client.query("COMMIT");
          return reply.code(429).send({
            success: false,
            message: `Too many failed attempts. Try again in ${minutesRemaining} minutes.`,
          });
        }

        const passwordValid = account.password_hash
          ? await verifyPassword(password, account.password_hash)
          : await verifyPassword(password, DUMMY_PASSWORD_HASH).then(() => false);

        if (!passwordValid) {
          const newFailedCount = account.failed_login_count + 1;
          const reachedThreshold = newFailedCount >= FAILED_LOGIN_THRESHOLD;
          await client.query(
            `UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3`,
            [
              newFailedCount,
              reachedThreshold ? new Date(Date.now() + LOCKOUT_DURATION_MS) : account.locked_until,
              account.id,
            ],
          );
          await client.query("COMMIT");
          return reply.code(401).send(GENERIC_INVALID_CREDENTIALS);
        }

        const token = generateSessionToken();
        await client.query(
          `INSERT INTO user_sessions (tenant_id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, account.id, hashSessionToken(token), sessionExpiryFromNow()],
        );
        await client.query(
          `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
          [account.id],
        );
        await client.query("COMMIT");

        reply.header("set-cookie", serializeTenantUserCookie(token, 8 * 60 * 60));
        return reply.code(200).send({
          success: true,
          data: { id: account.id, email: account.email, mustChangePassword: account.must_change_password },
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  fastify.get(
    "/tenant-auth/me",
    // Deliberately allowed while must_change_password is true (contracts/tenant-auth-api.md) — the
    // frontend needs this response's mustChangePassword field to know to redirect to
    // /set-password in the first place.
    { preHandler: [requireTenantUserSession({ allowMustChangePassword: true })] },
    async (request) => {
      // request.tenantDb (tenant-context.ts, unchanged) is already scoped to app.tenant_id from
      // request.user.tenantId by this point — never query fastify.pg.pool directly here, which has
      // no app.tenant_id set and would be blocked by RLS (0 rows, not an error).
      const [account] = (
        await request.tenantDb.execute<{ email: string }>(
          sql`SELECT email FROM users WHERE id = ${request.user!.id}`,
        )
      ).rows;

      // Role-Based Dashboard Shell spec (contracts/tenant-auth-me-amendment.md) — additive fields.
      // One row per (user_role, permission) pair; grouped by user_role_id since a role can carry
      // multiple permissions. `roleName` is the first role by creation order — per that spec's
      // Assumptions a user holds exactly one role in practice, so this degrades gracefully rather
      // than crashing if that's ever violated.
      const roleRows = await request.tenantDb.execute<UserRoleRow>(sql`
        SELECT ur.id AS user_role_id, r.name AS role_name, p.key AS permission_key
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
        LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ${request.user!.id}
        ORDER BY ur.created_at ASC
      `);
      const roleMap = new Map<string, { roleName: string; permissionKeys: string[] }>();
      for (const row of roleRows.rows) {
        let entry = roleMap.get(row.user_role_id);
        if (!entry) {
          entry = { roleName: row.role_name, permissionKeys: [] };
          roleMap.set(row.user_role_id, entry);
        }
        if (row.permission_key) entry.permissionKeys.push(row.permission_key);
      }
      const roleEntries = Array.from(roleMap.values());

      return {
        success: true,
        data: {
          id: request.user!.id,
          email: account.email,
          mustChangePassword: request.mustChangePassword,
          roleName: roleEntries[0]?.roleName ?? null,
          permissions: resolveEffectivePermissions(roleEntries),
        },
      };
    },
  );

  fastify.post(
    "/tenant-auth/logout",
    // Always allowed, even mid-must-change-password — no reason to trap a user into a session they
    // can't exit.
    { preHandler: [requireTenantUserSession({ allowMustChangePassword: true })] },
    async (request, reply) => {
      const token = parseCookie(request.headers.cookie, TENANT_USER_COOKIE_NAME);
      if (token) {
        await request.tenantDb.execute(
          sql`UPDATE user_sessions SET revoked_at = now() WHERE token_hash = ${hashSessionToken(token)}`,
        );
      }
      reply.header("set-cookie", serializeTenantUserCookie("", 0));
      return reply.code(204).send();
    },
  );

  fastify.post<{ Body: { newPassword?: string } }>(
    "/tenant-auth/set-password",
    // The one explicit exception to the must-change-password gate (FR-013a) — this IS the route
    // that clears it.
    { preHandler: [requireTenantUserSession({ allowMustChangePassword: true })] },
    async (request, reply) => {
      const newPassword = request.body?.newPassword;
      if (!newPassword) {
        return reply.code(400).send({ success: false, message: "newPassword is required" });
      }

      const passwordHash = await hashPassword(newPassword);
      await request.tenantDb.execute(
        sql`UPDATE users
            SET password_hash = ${passwordHash}, must_change_password = false, otp_expires_at = NULL
            WHERE id = ${request.user!.id}`,
      );
      return reply.code(204).send();
    },
  );

  fastify.post<{ Querystring: { subdomain?: string }; Body: { email?: string } }>(
    "/tenant-auth/forgot-password",
    async (request, reply) => {
      const subdomain = request.query.subdomain;
      const email = request.body?.email?.trim().toLowerCase();
      const GENERIC_OK = { success: true, message: "If that email exists, check your inbox." };
      if (!subdomain || !email) {
        return reply.code(200).send(GENERIC_OK);
      }

      const resolved = await resolveTenantBySubdomain(fastify.pg.pool, subdomain);
      if (resolved.state !== "valid" || !resolved.tenantId) {
        return reply.code(200).send(GENERIC_OK);
      }
      const tenantId = resolved.tenantId;

      const client = await fastify.pg.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

        const result = await client.query<{ id: string }>(
          "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
          [tenantId, email],
        );
        const account = result.rows[0];
        if (account) {
          const token = generateSessionToken();
          await client.query(
            `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, account.id, hashSessionToken(token), new Date(Date.now() + RESET_TOKEN_VALIDITY_MS)],
          );
          const rootDomain = process.env.ROOT_DOMAIN ?? "tm.com";
          const resetLink = `http://${subdomain}.${rootDomain}/reset-password?token=${token}&subdomain=${subdomain}`;
          try {
            await sendPasswordResetEmail(email, resetLink);
          } catch (err) {
            request.log.error(err, "Failed to send password reset email");
          }
        }

        await client.query("COMMIT");
        return reply.code(200).send(GENERIC_OK);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  fastify.post<{
    Querystring: { subdomain?: string };
    Body: { token?: string; newPassword?: string };
  }>("/tenant-auth/reset-password", async (request, reply) => {
    const subdomain = request.query.subdomain;
    const token = request.body?.token;
    const newPassword = request.body?.newPassword;
    if (!subdomain || !token || !newPassword) {
      return reply.code(400).send({ success: false, message: "Invalid request" });
    }

    const resolved = await resolveTenantBySubdomain(fastify.pg.pool, subdomain);
    if (resolved.state !== "valid" || !resolved.tenantId) {
      return reply.code(401).send({ success: false, message: "Invalid or expired token" });
    }
    const tenantId = resolved.tenantId;

    const client = await fastify.pg.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      const tokenHash = hashSessionToken(token);
      const result = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [tokenHash],
      );
      const resetToken = result.rows[0];
      if (!resetToken) {
        await client.query("COMMIT");
        return reply.code(401).send({ success: false, message: "Invalid or expired token" });
      }

      const passwordHash = await hashPassword(newPassword);
      // Forgotten-password reset only — deliberately does NOT touch must_change_password/
      // otp_expires_at (FR-014), unrelated to the OTP bootstrap mechanism (research.md §5-6).
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        passwordHash,
        resetToken.user_id,
      ]);
      await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [
        resetToken.id,
      ]);
      await client.query("COMMIT");
      return reply.code(200).send({ success: true });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
};

export default tenantAuthRoutes;
