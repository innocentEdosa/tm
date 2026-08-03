import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { platformCourses } from "../db/schema/platform-courses";
import { platformCourseHasFulfilledSelection } from "../course-marketplace/platform-course-immutability";
import { getPlatformCourseCurriculum } from "./platform-course-curriculum";

const DELIVERY_MODES = ["in_person", "virtual", "self_paced", "blended"] as const;
const DURATION_UNITS = ["minutes", "hours", "days"] as const;
const STATUSES = ["draft", "active", "archived"] as const;
const DEFAULT_PAGE_SIZE = 20;

/** Fields immutable once ≥1 fulfilled selection exists (data-model.md immutability rule; tasks.md
 * T038) — everything else (description, provider, cost, status) stays editable regardless. */
const IMMUTABLE_ONCE_CLONED_FIELDS = ["title", "categoryName", "deliveryMode", "duration"] as const;

type DeliveryMode = (typeof DELIVERY_MODES)[number];
type DurationUnit = (typeof DURATION_UNITS)[number];
type Status = (typeof STATUSES)[number];

interface PlatformCourseWriteBody {
  title?: string;
  description?: string | null;
  categoryName?: string;
  deliveryMode?: DeliveryMode;
  duration?: { value?: number; unit?: DurationUnit };
  provider?: string | null;
  cost?: number | null;
  status?: Status;
}

function validateFields(body: PlatformCourseWriteBody): { code: number; message: string } | null {
  if (body.deliveryMode !== undefined && !DELIVERY_MODES.includes(body.deliveryMode)) {
    return { code: 422, message: "Invalid deliveryMode" };
  }
  if (body.duration?.unit !== undefined && !DURATION_UNITS.includes(body.duration.unit)) {
    return { code: 422, message: "Invalid duration.unit" };
  }
  if (body.duration?.value !== undefined && !(body.duration.value > 0)) {
    return { code: 422, message: "duration.value must be greater than 0" };
  }
  if (body.cost !== undefined && body.cost !== null && body.cost < 0) {
    return { code: 422, message: "cost must be >= 0" };
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return { code: 422, message: "Invalid status" };
  }
  return null;
}

function toResponse(row: typeof platformCourses.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categoryName: row.categoryName,
    deliveryMode: row.deliveryMode,
    duration: { value: Number(row.durationValue), unit: row.durationUnit },
    provider: row.provider,
    cost: row.cost === null ? null : Number(row.cost),
    status: row.status,
    learningObjectives: row.learningObjectives,
    requirements: row.requirements,
    createdBySuperAdminId: row.createdBySuperAdminId,
    createdAt: row.createdAt,
    updatedBySuperAdminId: row.updatedBySuperAdminId,
    updatedAt: row.updatedAt,
  };
}

/** contracts/platform-course-authoring-api.md §platform-courses. Every route requires
 * `requireSuperAdminSession` and operates through `fastify.db` — these tables carry no `tenant_id`
 * and have no RLS at all (spec 029 plan.md Constitution Check). */
const platformCourseRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /admin/platform-courses — spec FR-001, contracts §POST.
  fastify.post<{ Body: PlatformCourseWriteBody }>(
    "/admin/platform-courses",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const body = request.body ?? {};
      if (
        !body.title?.trim() ||
        !body.categoryName?.trim() ||
        !body.deliveryMode ||
        body.duration?.value === undefined ||
        !body.duration?.unit
      ) {
        return reply.code(400).send({
          success: false,
          message: "title, categoryName, deliveryMode, and duration (value and unit) are required",
        });
      }

      const validation = validateFields(body);
      if (validation) {
        return reply.code(validation.code).send({ success: false, message: validation.message });
      }

      const [created] = await fastify.db
        .insert(platformCourses)
        .values({
          title: body.title.trim(),
          description: body.description ?? null,
          categoryName: body.categoryName.trim(),
          deliveryMode: body.deliveryMode,
          durationValue: body.duration.value,
          durationUnit: body.duration.unit,
          provider: body.provider ?? null,
          cost: body.cost ?? null,
          status: "draft",
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      return reply.code(201).send({ success: true, data: toResponse(created) });
    },
  );

  // PATCH /admin/platform-courses/:id — spec FR-002, contracts §PATCH. `status` accepts any of its
  // three enum values directly, no restricted transition graph (mirrors spec 023). Rejects 409 if the
  // request touches an immutable-once-cloned field on a course with ≥1 fulfilled selection.
  fastify.patch<{ Params: { id: string }; Body: PlatformCourseWriteBody }>(
    "/admin/platform-courses/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id } = request.params;
      const [existing] = await fastify.db.select().from(platformCourses).where(eq(platformCourses.id, id));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      const validation = validateFields(body);
      if (validation) {
        return reply.code(validation.code).send({ success: false, message: validation.message });
      }

      const touchesImmutableField = IMMUTABLE_ONCE_CLONED_FIELDS.some(
        (field) => (body as Record<string, unknown>)[field] !== undefined,
      );
      if (touchesImmutableField && (await platformCourseHasFulfilledSelection(request.superAdminDb!, id))) {
        return reply.code(409).send({
          success: false,
          message: "This platform course has already been selected by a tenant; title/category/deliveryMode/duration are frozen",
        });
      }

      const [updated] = await fastify.db
        .update(platformCourses)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.categoryName !== undefined ? { categoryName: body.categoryName.trim() } : {}),
          ...(body.deliveryMode !== undefined ? { deliveryMode: body.deliveryMode } : {}),
          ...(body.duration?.value !== undefined ? { durationValue: body.duration.value } : {}),
          ...(body.duration?.unit !== undefined ? { durationUnit: body.duration.unit } : {}),
          ...(body.provider !== undefined ? { provider: body.provider } : {}),
          ...(body.cost !== undefined ? { cost: body.cost } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          updatedBySuperAdminId: request.superAdmin!.id,
          updatedAt: new Date(),
        })
        .where(eq(platformCourses.id, id))
        .returning();

      return reply.code(200).send({ success: true, data: toResponse(updated) });
    },
  );

  // PATCH /admin/platform-courses/:id/objectives — mirrors tenant-course-routes.ts's
  // `PATCH /tenant/courses/:courseId/objectives` exactly (same validation, same drop-blank-entries
  // behavior), so the shared Course Objectives panel can be reused unmodified for platform-course
  // authoring. Not an immutable-once-cloned field (not in IMMUTABLE_ONCE_CLONED_FIELDS) — objectives
  // are informational, not part of the frozen curriculum contract.
  fastify.patch<{ Params: { id: string }; Body: { learningObjectives?: unknown; requirements?: unknown } }>(
    "/admin/platform-courses/:id/objectives",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id } = request.params;
      const [existing] = await fastify.db.select({ id: platformCourses.id }).from(platformCourses).where(eq(platformCourses.id, id));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (!Array.isArray(body.learningObjectives) || !Array.isArray(body.requirements)) {
        return reply.code(400).send({ success: false, message: "learningObjectives and requirements must be arrays" });
      }
      const learningObjectives = body.learningObjectives.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
      const requirements = body.requirements.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);

      const [updated] = await fastify.db
        .update(platformCourses)
        .set({ learningObjectives, requirements, updatedBySuperAdminId: request.superAdmin!.id, updatedAt: new Date() })
        .where(eq(platformCourses.id, id))
        .returning();

      return reply.code(200).send({ success: true, data: toResponse(updated) });
    },
  );

  // GET /admin/platform-courses — spec FR-002, contracts §GET list.
  fastify.get<{
    Querystring: { search?: string; category?: string; deliveryMode?: string; status?: string };
  }>("/admin/platform-courses", { preHandler: [requireSuperAdminSession] }, async (request) => {
    const conditions = [];
    if (request.query.status) {
      conditions.push(eq(platformCourses.status, request.query.status));
    } else {
      conditions.push(ne(platformCourses.status, "archived"));
    }
    if (request.query.category) {
      conditions.push(eq(platformCourses.categoryName, request.query.category));
    }
    if (request.query.deliveryMode) {
      conditions.push(eq(platformCourses.deliveryMode, request.query.deliveryMode));
    }
    if (request.query.search) {
      conditions.push(sql`${platformCourses.title} ILIKE ${`%${request.query.search}%`}`);
    }

    const rows = await fastify.db
      .select()
      .from(platformCourses)
      .where(and(...conditions))
      .orderBy(desc(platformCourses.createdAt));

    return { success: true, data: rows.map(toResponse) };
  });

  // GET /admin/platform-courses/:id — spec FR-002, contracts §GET detail.
  fastify.get<{ Params: { id: string } }>(
    "/admin/platform-courses/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const [existing] = await fastify.db.select().from(platformCourses).where(eq(platformCourses.id, request.params.id));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const curriculum = await getPlatformCourseCurriculum(fastify.db, existing.id);
      return { success: true, data: { ...toResponse(existing), modules: curriculum } };
    },
  );
};

export default platformCourseRoutes;
