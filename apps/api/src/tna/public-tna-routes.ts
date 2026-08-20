import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { resolveTenantBySubdomain } from "../tenant-routing/resolve-tenant";
import { hashSessionToken } from "../platform-auth/session";
import { tnaAssignments } from "../db/schema/tna-assignments";
import { tnaExercises } from "../db/schema/tna-exercises";
import { departments } from "../db/schema/departments";
import { getFormFields } from "../custom-fields/field-key-uniqueness";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";
import { getEffectiveForm } from "../form-builder/get-effective-form";
import { TNA_RESPONSE_FORM_KEY, isExerciseOpenForSubmission, getTnaResponseValues } from "./tna-shared";
import type { Db } from "../db/client";

interface ResolvedAssignment {
  id: string;
  userId: string;
  departmentId: string | null;
  status: "pending" | "submitted";
  submittedAt: Date | null;
  exerciseId: string;
  exerciseTitle: string;
  exerciseDescription: string | null;
  exerciseStatus: string;
  endDate: string;
}

type Outcome<T> = { ok: true; result: T } | { ok: false; code: number; message: string };

/**
 * No-login magic-link access to a TNA response (tenant-tna-routes.ts's `notifyTnaParticipants`
 * mints the raw token, mailed once, never stored). Every route here resolves its own tenant-scoped
 * connection from a client-supplied `subdomain` — the same "resolve tenant first, hand-roll a
 * `set_config('app.tenant_id', ...)` transaction on `fastify.pg.pool` directly" pattern
 * `tenant-auth-routes.ts`'s forgot/reset-password routes already established, since `request.tenantDb`
 * (tenant-context.ts) only exists for an authenticated `request.user` — there is deliberately no
 * session here at all. The token itself (matched by its hash, mirroring `password_reset_tokens`) is
 * the sole authorization: whoever holds the raw token can view/save/submit that one assignment,
 * nothing else, matching the ownership-based access the session-authenticated
 * `/tenant/tna-assignments/*` routes already grant an assignment's own owner.
 */
const publicTnaRoutes: FastifyPluginAsync = async (fastify) => {
  async function withAssignment<T>(
    subdomain: string | undefined,
    token: string | undefined,
    fn: (db: Db, tenantId: string, assignment: ResolvedAssignment) => Promise<T>,
  ): Promise<Outcome<T>> {
    if (!subdomain || !token) {
      return { ok: false, code: 400, message: "Invalid link" };
    }
    const resolved = await resolveTenantBySubdomain(fastify.pg.pool, subdomain);
    if (resolved.state !== "valid" || !resolved.tenantId) {
      return { ok: false, code: 404, message: "This link is invalid or has expired." };
    }
    const tenantId = resolved.tenantId;

    const client = await fastify.pg.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const db = drizzle(client);

      const [row] = await db
        .select({
          id: tnaAssignments.id,
          userId: tnaAssignments.userId,
          departmentId: tnaAssignments.departmentId,
          status: tnaAssignments.status,
          submittedAt: tnaAssignments.submittedAt,
          exerciseId: tnaExercises.id,
          exerciseTitle: tnaExercises.title,
          exerciseDescription: tnaExercises.description,
          exerciseStatus: tnaExercises.status,
          endDate: tnaExercises.endDate,
        })
        .from(tnaAssignments)
        .innerJoin(tnaExercises, eq(tnaExercises.id, tnaAssignments.tnaExerciseId))
        .where(eq(tnaAssignments.magicLinkTokenHash, hashSessionToken(token)));

      if (!row) {
        await client.query("COMMIT");
        return { ok: false, code: 404, message: "This link is invalid or has expired." };
      }

      const result = await fn(db, tenantId, row as ResolvedAssignment);
      await client.query("COMMIT");
      return { ok: true, result };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // GET /public/tna-assignments?token=&subdomain= — everything the magic-link landing page needs
  // in one call: the assignment's own state, the exercise it belongs to, any already-saved response
  // values, and the effective `tna_response` form definition (the authenticated equivalent gets the
  // latter from a *separate*, session-gated `GET /tenant/forms/:formKey/effective` call via
  // `useEffectiveForm` — not reachable here with no session, so it's bundled into this response
  // instead rather than standing up a second public form-definition endpoint).
  fastify.get<{ Querystring: { token?: string; subdomain?: string } }>("/public/tna-assignments", async (request, reply) => {
    const outcome = await withAssignment(request.query.subdomain, request.query.token, async (db, tenantId, assignment) => {
      const [department] = assignment.departmentId
        ? await db.select({ name: departments.name }).from(departments).where(eq(departments.id, assignment.departmentId))
        : [];
      const responseValues = await getTnaResponseValues(db, assignment.id);
      const form = await getEffectiveForm(db, TNA_RESPONSE_FORM_KEY, tenantId);
      return {
        id: assignment.id,
        departmentName: department?.name ?? null,
        status: assignment.status,
        submittedAt: assignment.submittedAt,
        exerciseTitle: assignment.exerciseTitle,
        exerciseDescription: assignment.exerciseDescription,
        exerciseStatus: assignment.exerciseStatus,
        endDate: assignment.endDate,
        responseValues,
        form,
      };
    });
    if (!outcome.ok) return reply.code(outcome.code).send({ success: false, message: outcome.message });
    return { success: true, data: outcome.result };
  });

  // PATCH /public/tna-assignments?token=&subdomain= — save progress, no login required. Same
  // pending/open-for-submission rules as the session-authenticated PATCH.
  fastify.patch<{ Querystring: { token?: string; subdomain?: string }; Body: { values?: Record<string, unknown> } }>(
    "/public/tna-assignments",
    async (request, reply) => {
      const outcome = await withAssignment(request.query.subdomain, request.query.token, async (db, tenantId, assignment) => {
        if (assignment.status !== "pending") {
          return { blocked: "This response has already been submitted." };
        }
        if (!isExerciseOpenForSubmission(assignment.exerciseStatus, assignment.endDate)) {
          return { blocked: "This Training Needs Analysis is not currently accepting responses." };
        }
        const values = request.body?.values ?? {};
        const fields = await getFormFields(db, TNA_RESPONSE_FORM_KEY);
        await writeCustomFieldValues(db, tenantId, TNA_RESPONSE_FORM_KEY, assignment.id, values, fields);
        return { blocked: null };
      });
      if (!outcome.ok) return reply.code(outcome.code).send({ success: false, message: outcome.message });
      if (outcome.result.blocked) return reply.code(409).send({ success: false, message: outcome.result.blocked });
      return { success: true, data: { id: "ok" } };
    },
  );

  // POST /public/tna-assignments/submit?token=&subdomain= — validate + lock, no login required.
  // Same required-field validation and terminal-lock behavior as the session-authenticated submit.
  fastify.post<{ Querystring: { token?: string; subdomain?: string }; Body: { values?: Record<string, unknown> } }>(
    "/public/tna-assignments/submit",
    async (request, reply) => {
      const outcome = await withAssignment(request.query.subdomain, request.query.token, async (db, tenantId, assignment) => {
        if (assignment.status !== "pending") {
          return { blocked: "This response has already been submitted.", errors: null as { fieldKey: string; message: string }[] | null };
        }
        if (!isExerciseOpenForSubmission(assignment.exerciseStatus, assignment.endDate)) {
          return { blocked: "This Training Needs Analysis is not currently accepting responses.", errors: null };
        }
        const values = request.body?.values ?? {};
        const fields = await getFormFields(db, TNA_RESPONSE_FORM_KEY);
        const errors = validateCustomFieldValues(values, fields);
        if (errors.length > 0) {
          return { blocked: null, errors };
        }
        await writeCustomFieldValues(db, tenantId, TNA_RESPONSE_FORM_KEY, assignment.id, values, fields);
        await db
          .update(tnaAssignments)
          .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
          .where(eq(tnaAssignments.id, assignment.id));
        return { blocked: null, errors: null };
      });
      if (!outcome.ok) return reply.code(outcome.code).send({ success: false, message: outcome.message });
      if (outcome.result.blocked) return reply.code(409).send({ success: false, message: outcome.result.blocked });
      if (outcome.result.errors) return reply.code(422).send({ success: false, errors: outcome.result.errors });
      return { success: true, data: { id: "ok" } };
    },
  );
};

export default publicTnaRoutes;
