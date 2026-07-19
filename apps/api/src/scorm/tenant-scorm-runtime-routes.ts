import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { contentItems } from "../db/schema/course-content";
import { scormPackageItems } from "../db/schema/scorm";
import { learnerContentProgress } from "../db/schema/learner-content-progress";
import { scormCmiObjectives, scormCmiInteractions } from "../db/schema/scorm";
import { users } from "../db/schema/users";
import { SCORM_LESSON_STATUSES, mapLessonStatusToProgressStatus } from "./lesson-status-mapping";
import { guessContentType } from "./mime-types";
import * as storage from "../storage/storage";

const SUSPEND_DATA_MAX_LENGTH = 4096;

interface CmiObjectiveInput {
  objectiveId?: string;
  status?: string;
  scoreRaw?: number;
  scoreMin?: number;
  scoreMax?: number;
}

interface CmiInteractionInput {
  interactionId?: string;
  type?: string;
  weighting?: number;
  studentResponse?: string;
  result?: string;
  latency?: string;
  correctResponses?: unknown;
}

interface CmiCommitBody {
  lessonStatus?: string;
  scoreRaw?: number;
  scoreMin?: number;
  scoreMax?: number;
  bookmark?: string;
  suspendData?: string;
  sessionTimeSeconds?: number;
  objectives?: CmiObjectiveInput[];
  interactions?: CmiInteractionInput[];
}

/** contracts/scorm-runtime-api.md. Learner runtime routes — `course.view` (or `course.manage`), reusing
 * the Learner Progress spec's own access model (research.md §4/§10). */
const tenantScormRuntimeRoutes: FastifyPluginAsync = async (fastify) => {
  async function resolveScoPackageItem(tenantDb: typeof fastify.db, contentItemId: string) {
    const [item] = await tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentItemId));
    if (!item) return null;
    const [scoItem] = await tenantDb.select().from(scormPackageItems).where(eq(scormPackageItems.contentItemId, contentItemId));
    if (!scoItem) return null;
    return scoItem;
  }

  // GET /tenant/content-items/:contentItemId/scorm/launch — spec FR-005/FR-011, contracts §GET launch.
  fastify.get<{ Params: { contentItemId: string } }>(
    "/tenant/content-items/:contentItemId/scorm/launch",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const scoItem = await resolveScoPackageItem(request.tenantDb, contentItemId);
      if (!scoItem) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const siblings = await request.tenantDb.select().from(scormPackageItems).where(eq(scormPackageItems.packageId, scoItem.packageId));
      siblings.sort((a, b) => a.position - b.position);

      const siblingContentItemIds = siblings.map((s) => s.contentItemId);
      const siblingProgressRows = await request.tenantDb
        .select()
        .from(learnerContentProgress)
        .where(and(eq(learnerContentProgress.userId, request.user!.id), inArray(learnerContentProgress.contentItemId, siblingContentItemIds)));
      const progressByContentItemId = new Map(siblingProgressRows.map((r) => [r.contentItemId, r]));

      const titleById = new Map(
        (await request.tenantDb.select({ id: contentItems.id, title: contentItems.title }).from(contentItems).where(inArray(contentItems.id, siblingContentItemIds))).map((c) => [c.id, c.title]),
      );

      const scos = siblings.map((s) => ({
        contentItemId: s.contentItemId,
        title: titleById.get(s.contentItemId) ?? "",
        position: s.position,
        status: progressByContentItemId.get(s.contentItemId)?.status ?? "not_started",
      }));

      const anyTouched = scos.some((s) => s.status !== "not_started");
      const allCompleted = scos.every((s) => s.status === "completed");
      const packageStatus = allCompleted ? "completed" : anyTouched ? "in_progress" : "not_started";

      const progress = progressByContentItemId.get(contentItemId);
      const objectives = progress
        ? await request.tenantDb.select().from(scormCmiObjectives).where(and(eq(scormCmiObjectives.userId, request.user!.id), eq(scormCmiObjectives.contentItemId, contentItemId)))
        : [];
      const interactions = progress
        ? await request.tenantDb.select().from(scormCmiInteractions).where(and(eq(scormCmiInteractions.userId, request.user!.id), eq(scormCmiInteractions.contentItemId, contentItemId)))
        : [];

      const [caller] = await request.tenantDb.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.id, request.user!.id));

      return {
        success: true,
        data: {
          packageId: scoItem.packageId,
          entryPointUrl: `/tenant-api/tenant/scorm/packages/${scoItem.packageId}/files/${scoItem.entryPointRelativePath}`,
          cmi: {
            lessonStatus: progress?.scormRawLessonStatus ?? "not attempted",
            scoreRaw: progress?.scoreRaw ?? null,
            scoreMin: progress?.scoreMin ?? null,
            scoreMax: progress?.scoreMax ?? null,
            bookmark: progress?.bookmark ?? null,
            suspendData: progress?.suspendData ?? null,
            totalTimeSeconds: progress?.totalTimeSeconds ?? 0,
            entry: progress ? "resume" : "ab-initio",
            objectives: objectives
              .sort((a, b) => a.objectiveIndex - b.objectiveIndex)
              .map((o) => ({ objectiveId: o.objectiveId, status: o.status, scoreRaw: o.scoreRaw, scoreMin: o.scoreMin, scoreMax: o.scoreMax })),
            interactions: interactions
              .sort((a, b) => a.interactionIndex - b.interactionIndex)
              .map((i) => ({
                interactionId: i.interactionId,
                type: i.type,
                weighting: i.weighting,
                studentResponse: i.studentResponse,
                result: i.result,
                latency: i.latency,
                correctResponses: i.correctResponses,
              })),
          },
          studentId: caller.id,
          studentName: caller.fullName,
          navigation: { position: scoItem.position, packageStatus, scos },
        },
      };
    },
  );

  // GET /tenant/scorm/packages/:packageId/files/* — contracts §GET files, research.md §7.
  fastify.get<{ Params: { packageId: string; "*": string } }>(
    "/tenant/scorm/packages/:packageId/files/*",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { packageId } = request.params;
      const relativePath = request.params["*"];

      const [packageItem] = await request.tenantDb.select({ id: scormPackageItems.id }).from(scormPackageItems).where(eq(scormPackageItems.packageId, packageId));
      if (!packageItem) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const key = `${request.user!.tenantId}/scorm/${packageId}/${relativePath}`;
      const object = await storage.getObjectStream(key);
      if (!object) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      reply.header("Content-Type", object.contentType ?? guessContentType(relativePath));
      return reply.send(object.stream);
    },
  );

  // PUT /tenant/content-items/:contentItemId/scorm/cmi — spec FR-007/FR-008, contracts §PUT cmi.
  fastify.put<{ Params: { contentItemId: string }; Body: CmiCommitBody }>(
    "/tenant/content-items/:contentItemId/scorm/cmi",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const scoItem = await resolveScoPackageItem(request.tenantDb, contentItemId);
      if (!scoItem) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (!body.lessonStatus || !SCORM_LESSON_STATUSES.includes(body.lessonStatus as (typeof SCORM_LESSON_STATUSES)[number])) {
        return reply.code(400).send({ success: false, message: `lessonStatus must be one of: ${SCORM_LESSON_STATUSES.join(", ")}` });
      }
      if (typeof body.suspendData === "string" && body.suspendData.length > SUSPEND_DATA_MAX_LENGTH) {
        return reply.code(400).send({ success: false, message: `suspendData must not exceed ${SUSPEND_DATA_MAX_LENGTH} characters` });
      }

      const sessionTimeSeconds = typeof body.sessionTimeSeconds === "number" ? body.sessionTimeSeconds : 0;
      const status = mapLessonStatusToProgressStatus(body.lessonStatus);
      const now = new Date();

      await request.tenantDb
        .insert(learnerContentProgress)
        .values({
          tenantId: request.user!.tenantId,
          userId: request.user!.id,
          contentItemId,
          status,
          scormRawLessonStatus: body.lessonStatus,
          scoreRaw: body.scoreRaw ?? null,
          scoreMin: body.scoreMin ?? null,
          scoreMax: body.scoreMax ?? null,
          bookmark: body.bookmark ?? null,
          suspendData: body.suspendData ?? null,
          sessionTimeSeconds,
          totalTimeSeconds: sessionTimeSeconds,
          enteredAt: now,
          exitedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [learnerContentProgress.tenantId, learnerContentProgress.userId, learnerContentProgress.contentItemId],
          set: {
            status,
            scormRawLessonStatus: body.lessonStatus,
            ...(body.scoreRaw !== undefined ? { scoreRaw: body.scoreRaw } : {}),
            ...(body.scoreMin !== undefined ? { scoreMin: body.scoreMin } : {}),
            ...(body.scoreMax !== undefined ? { scoreMax: body.scoreMax } : {}),
            ...(body.bookmark !== undefined ? { bookmark: body.bookmark } : {}),
            ...(body.suspendData !== undefined ? { suspendData: body.suspendData } : {}),
            sessionTimeSeconds,
            totalTimeSeconds: sql`${learnerContentProgress.totalTimeSeconds} + ${sessionTimeSeconds}`,
            exitedAt: now,
            updatedAt: now,
          },
        });

      await request.tenantDb.delete(scormCmiObjectives).where(and(eq(scormCmiObjectives.userId, request.user!.id), eq(scormCmiObjectives.contentItemId, contentItemId)));
      if (body.objectives && body.objectives.length > 0) {
        await request.tenantDb.insert(scormCmiObjectives).values(
          body.objectives.map((o, index) => ({
            tenantId: request.user!.tenantId,
            userId: request.user!.id,
            contentItemId,
            objectiveIndex: index,
            objectiveId: o.objectiveId ?? null,
            status: o.status ?? null,
            scoreRaw: o.scoreRaw ?? null,
            scoreMin: o.scoreMin ?? null,
            scoreMax: o.scoreMax ?? null,
          })),
        );
      }

      await request.tenantDb.delete(scormCmiInteractions).where(and(eq(scormCmiInteractions.userId, request.user!.id), eq(scormCmiInteractions.contentItemId, contentItemId)));
      if (body.interactions && body.interactions.length > 0) {
        await request.tenantDb.insert(scormCmiInteractions).values(
          body.interactions.map((i, index) => ({
            tenantId: request.user!.tenantId,
            userId: request.user!.id,
            contentItemId,
            interactionIndex: index,
            interactionId: i.interactionId ?? null,
            type: i.type ?? null,
            weighting: i.weighting ?? null,
            studentResponse: i.studentResponse ?? null,
            result: i.result ?? null,
            latency: i.latency ?? null,
            correctResponses: i.correctResponses ?? null,
          })),
        );
      }

      return { success: true };
    },
  );
};

export default tenantScormRuntimeRoutes;
