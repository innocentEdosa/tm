import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission, userHasAnyPermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseCategories } from "../db/schema/course-categories";
import { courseModules, contentItems } from "../db/schema/course-content";
import { courseAuthors } from "../db/schema/course-authors";
import { courseReviews } from "../db/schema/course-reviews";
import { fileAttachments } from "../db/schema/file-attachments";
import { users } from "../db/schema/users";
import { resolveOrCreateCourseCategory } from "./course-category-resolution";
import { deleteAllAttachmentsForEntity } from "../attachments/tenant-attachment-routes";
import * as storage from "../storage/storage";

const DELIVERY_MODES = ["in_person", "virtual", "self_paced", "blended"] as const;
const DURATION_UNITS = ["minutes", "hours", "days"] as const;
const STATUSES = ["draft", "active", "archived"] as const;
const DEFAULT_PAGE_SIZE = 20;

type DeliveryMode = (typeof DELIVERY_MODES)[number];
type DurationUnit = (typeof DURATION_UNITS)[number];
type Status = (typeof STATUSES)[number];

type CourseRow = typeof courses.$inferSelect;

/** Course Assignment Settings' visibility gate — a course is visible to a caller who lacks
 * `course.manage` (i.e. a learner, not a course admin) when it has no assignment rows at all
 * (never configured, or created before this feature — treated the same as an explicit "Everyone"
 * row for backward compatibility), an explicit `assignee_type = 'all'` row, a `'user'` row naming
 * them directly, a `'department'` row naming their own department, or a `'role'` row naming any
 * role they hold. Callers with `course.manage` never have this condition applied at all — course
 * admins always see every course regardless of who it's assigned to. */
export function buildAssignmentVisibilityCondition(userId: string) {
  return sql`(
    NOT EXISTS (SELECT 1 FROM course_assignments ca WHERE ca.course_id = ${courses.id})
    OR EXISTS (SELECT 1 FROM course_assignments ca WHERE ca.course_id = ${courses.id} AND ca.assignee_type = 'all')
    OR EXISTS (SELECT 1 FROM course_assignments ca WHERE ca.course_id = ${courses.id} AND ca.assignee_type = 'user' AND ca.user_id = ${userId})
    OR EXISTS (
      SELECT 1 FROM course_assignments ca
      JOIN users u ON u.id = ${userId}
      WHERE ca.course_id = ${courses.id} AND ca.assignee_type = 'department' AND ca.department_id = u.department_id
    )
    OR EXISTS (
      SELECT 1 FROM course_assignments ca
      JOIN user_roles ur ON ur.role_id = ca.role_id AND ur.user_id = ${userId}
      WHERE ca.course_id = ${courses.id} AND ca.assignee_type = 'role'
    )
  )`;
}

/** Every learner-facing course-detail route (curriculum, authors, progress, reviews — all now open
 * to any authenticated tenant user, not just `course.view`/`course.manage` holders per "My Learning
 * accessible by everyone") needs this same "can this caller actually see this course" check that
 * `GET /tenant/courses/:courseId` already applies — `course.manage` always bypasses it; everyone
 * else only sees a course per `buildAssignmentVisibilityCondition`. */
export async function isCourseVisibleToCaller(tenantDb: Db, userId: string, courseId: string): Promise<boolean> {
  const canManage = await userHasAnyPermission(tenantDb, userId, ["course.manage"]);
  if (canManage) return true;
  const [visible] = await tenantDb
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), buildAssignmentVisibilityCondition(userId)));
  return !!visible;
}

interface CourseWriteBody {
  title?: string;
  description?: string | null;
  category?: string;
  deliveryMode?: DeliveryMode;
  duration?: { value?: number; unit?: DurationUnit };
  provider?: string | null;
  cost?: number | null;
  subcategory?: string | null;
  status?: Status;
}

/** Shared by POST/PATCH — validates any field present in the body against its fixed enum/shape
 * (spec FR-010). Required-field presence is checked separately by each route (POST requires more
 * fields up front than PATCH, where every field is optional). */
function validateFields(body: CourseWriteBody): { code: number; message: string } | null {
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

/** contracts/course-management-api.md. All routes operate through `request.tenantDb` (RLS-scoped)
 * — no route ever takes or trusts a client-supplied tenant id. */
const tenantCourseRoutes: FastifyPluginAsync = async (fastify) => {
  /** Batch-joins category name and creator/updater full names for a page of course rows — mirrors
   * `tenant-department-routes.ts`'s `userById` Map pattern for manager/assistantManager. Also
   * batch-resolves each course's current image (if any) to a fresh presigned download URL —
   * `file_attachments` rows never store a stable public URL, so this is computed at read time, the
   * same way the SCORM launch route computes `entryPointUrl` server-side. */
  async function toResponseRows(tenantDb: typeof fastify.db, rows: CourseRow[]) {
    const categoryIds = Array.from(new Set(rows.map((r) => r.categoryId)));
    const categoryRows =
      categoryIds.length > 0
        ? await tenantDb
            .select({ id: courseCategories.id, name: courseCategories.name })
            .from(courseCategories)
            .where(inArray(courseCategories.id, categoryIds))
        : [];
    const categoryById = new Map(categoryRows.map((c) => [c.id, c]));

    const userIds = Array.from(
      new Set(
        rows.flatMap((r) => [r.createdByUserId, r.updatedByUserId]).filter((id): id is string => !!id),
      ),
    );
    const userRows =
      userIds.length > 0
        ? await tenantDb.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, userIds))
        : [];
    const userById = new Map(userRows.map((u) => [u.id, u]));

    const courseIds = rows.map((r) => r.id);
    const moduleCountRows =
      courseIds.length > 0
        ? await tenantDb
            .select({ courseId: courseModules.courseId, count: sql<number>`count(*)::int` })
            .from(courseModules)
            .where(inArray(courseModules.courseId, courseIds))
            .groupBy(courseModules.courseId)
        : [];
    const moduleCountByCourseId = new Map(moduleCountRows.map((r) => [r.courseId, r.count]));

    const imageAttachments =
      courseIds.length > 0
        ? await tenantDb
            .select({ entityId: fileAttachments.entityId, storageKey: fileAttachments.storageKey, createdAt: fileAttachments.createdAt })
            .from(fileAttachments)
            .where(and(eq(fileAttachments.entityType, "course"), inArray(fileAttachments.entityId, courseIds), eq(fileAttachments.status, "ready")))
            .orderBy(desc(fileAttachments.createdAt))
        : [];
    // First occurrence per course id wins (rows are already ordered newest-first) — a course only
    // ever has one "current" image (uploading a new one deletes the prior attachment).
    const latestImageKeyByCourseId = new Map<string, string>();
    for (const a of imageAttachments) {
      if (!latestImageKeyByCourseId.has(a.entityId) && a.storageKey) {
        latestImageKeyByCourseId.set(a.entityId, a.storageKey);
      }
    }
    const imageUrlByCourseId = new Map<string, string>();
    if (latestImageKeyByCourseId.size > 0 && storage.isStorageConfigured()) {
      await Promise.all(
        Array.from(latestImageKeyByCourseId.entries()).map(async ([courseId, key]) => {
          imageUrlByCourseId.set(courseId, await storage.createPresignedDownloadUrl(key));
        }),
      );
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: categoryById.get(r.categoryId) ?? null,
      deliveryMode: r.deliveryMode,
      duration: { value: Number(r.durationValue), unit: r.durationUnit },
      provider: r.provider,
      cost: r.cost === null ? null : Number(r.cost),
      subcategory: r.subcategory,
      learningObjectives: r.learningObjectives,
      requirements: r.requirements,
      courseImageUrl: imageUrlByCourseId.get(r.id) ?? null,
      moduleCount: moduleCountByCourseId.get(r.id) ?? 0,
      status: r.status,
      createdBy: r.createdByUserId ? (userById.get(r.createdByUserId) ?? null) : null,
      createdAt: r.createdAt,
      updatedBy: r.updatedByUserId ? (userById.get(r.updatedByUserId) ?? null) : null,
      updatedAt: r.updatedAt,
    }));
  }

  // GET /tenant/courses — spec FR-002/FR-003, contracts §GET list.
  fastify.get<{
    Querystring: {
      search?: string;
      category?: string;
      deliveryMode?: string;
      status?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    "/tenant/courses",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      const tenantId = request.user!.tenantId;
      const conditions = [eq(courses.tenantId, tenantId)];

      const canManage = await userHasAnyPermission(request.tenantDb, request.user!.id, ["course.manage"]);
      if (!canManage) {
        conditions.push(buildAssignmentVisibilityCondition(request.user!.id));
      }

      if (request.query.status) {
        conditions.push(eq(courses.status, request.query.status));
      } else {
        conditions.push(ne(courses.status, "archived"));
      }
      if (request.query.category) {
        conditions.push(eq(courses.categoryId, request.query.category));
      }
      if (request.query.deliveryMode) {
        conditions.push(eq(courses.deliveryMode, request.query.deliveryMode));
      }
      if (request.query.search) {
        conditions.push(sql`${courses.title} ILIKE ${`%${request.query.search}%`}`);
      }

      const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
      const pageSize = Math.max(1, parseInt(request.query.pageSize ?? "", 10) || DEFAULT_PAGE_SIZE);

      const [{ count: total }] = await request.tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(courses)
        .where(and(...conditions));

      const rows = await request.tenantDb
        .select()
        .from(courses)
        .where(and(...conditions))
        .orderBy(desc(courses.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const data = await toResponseRows(request.tenantDb, rows);
      return { success: true, data, pagination: { page, pageSize, total } };
    },
  );

  // GET /tenant/courses/categories — spec FR-001c, contracts §GET categories. Fastify's radix-tree
  // router matches this static path ahead of `:courseId` below regardless of registration order, so
  // "categories" is never captured as a course id.
  fastify.get(
    "/tenant/courses/categories",
    { preHandler: [requireTenantUserSession()] },
    async (request) => {
      const rows = await request.tenantDb
        .select({ id: courseCategories.id, name: courseCategories.name })
        .from(courseCategories)
        .orderBy(courseCategories.name);
      return { success: true, data: rows };
    },
  );

  // GET /tenant/courses/:courseId — spec FR-004, contracts §GET by id.
  fastify.get<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const [existing] = await request.tenantDb.select().from(courses).where(eq(courses.id, request.params.courseId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const canManage = await userHasAnyPermission(request.tenantDb, request.user!.id, ["course.manage"]);
      if (!canManage) {
        const [visible] = await request.tenantDb
          .select({ id: courses.id })
          .from(courses)
          .where(and(eq(courses.id, request.params.courseId), buildAssignmentVisibilityCondition(request.user!.id)));
        // Not "Forbidden" — matches every other route's 404-for-absent shape, so a learner outside
        // a course's assigned audience can't distinguish "doesn't exist" from "not assigned to you".
        if (!visible) {
          return reply.code(404).send({ success: false, message: "Not found" });
        }
      }

      const [data] = await toResponseRows(request.tenantDb, [existing]);
      return { success: true, data };
    },
  );

  // POST /tenant/courses — spec FR-001/FR-001a-c/FR-009/FR-010, contracts §POST.
  fastify.post<{ Body: CourseWriteBody }>(
    "/tenant/courses",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const body = request.body ?? {};
      if (!body.title?.trim() || !body.category?.trim() || !body.deliveryMode || body.duration?.value === undefined || !body.duration?.unit) {
        return reply.code(400).send({
          success: false,
          message: "title, category, deliveryMode, and duration (value and unit) are required",
        });
      }

      const validation = validateFields(body);
      if (validation) {
        return reply.code(validation.code).send({ success: false, message: validation.message });
      }

      const tenantId = request.user!.tenantId;
      const category = await resolveOrCreateCourseCategory(request.tenantDb, tenantId, body.category, request.user!.id);

      const [created] = await request.tenantDb
        .insert(courses)
        .values({
          tenantId,
          title: body.title.trim(),
          description: body.description ?? null,
          categoryId: category.id,
          deliveryMode: body.deliveryMode,
          durationValue: body.duration.value,
          durationUnit: body.duration.unit,
          provider: body.provider ?? null,
          cost: body.cost ?? null,
          subcategory: body.subcategory ?? null,
          status: "draft",
          createdByUserId: request.user!.id,
        })
        .returning();

      const [data] = await toResponseRows(request.tenantDb, [created]);
      return reply.code(201).send({ success: true, data });
    },
  );

  // PATCH /tenant/courses/:courseId — spec FR-005/FR-009/FR-010, contracts §PATCH. `status` accepts
  // any of its three enum values directly, no restricted transition graph (spec Clarifications) —
  // un-archiving is just a normal field update via this same handler.
  fastify.patch<{ Params: { courseId: string }; Body: CourseWriteBody }>(
    "/tenant/courses/:courseId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const [existing] = await request.tenantDb.select().from(courses).where(eq(courses.id, courseId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      const validation = validateFields(body);
      if (validation) {
        return reply.code(validation.code).send({ success: false, message: validation.message });
      }

      let categoryId: string | undefined;
      if (body.category !== undefined) {
        const category = await resolveOrCreateCourseCategory(
          request.tenantDb,
          request.user!.tenantId,
          body.category,
          request.user!.id,
        );
        categoryId = category.id;
      }

      const [updated] = await request.tenantDb
        .update(courses)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(body.deliveryMode !== undefined ? { deliveryMode: body.deliveryMode } : {}),
          ...(body.duration?.value !== undefined ? { durationValue: body.duration.value } : {}),
          ...(body.duration?.unit !== undefined ? { durationUnit: body.duration.unit } : {}),
          ...(body.provider !== undefined ? { provider: body.provider } : {}),
          ...(body.cost !== undefined ? { cost: body.cost } : {}),
          ...(body.subcategory !== undefined ? { subcategory: body.subcategory } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          updatedByUserId: request.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(courses.id, courseId))
        .returning();

      const [data] = await toResponseRows(request.tenantDb, [updated]);
      return reply.code(200).send({ success: true, data });
    },
  );

  // POST /tenant/courses/:courseId/archive — spec FR-006, contracts §POST archive. Idempotent: an
  // already-archived course is re-saved as-is (no error), same as any other no-op update.
  fastify.post<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/archive",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const [existing] = await request.tenantDb.select().from(courses).where(eq(courses.id, courseId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const [updated] = await request.tenantDb
        .update(courses)
        .set({ status: "archived", updatedByUserId: request.user!.id, updatedAt: new Date() })
        .where(eq(courses.id, courseId))
        .returning();

      const [data] = await toResponseRows(request.tenantDb, [updated]);
      return reply.code(200).send({ success: true, data });
    },
  );

  // PATCH /tenant/courses/:courseId/objectives — Course Objectives panel's own save action,
  // independent of the main Course Details form (matching the frontend's separate save button).
  // Neither list is required — a blank/omitted entry is simply dropped, never rejected.
  fastify.patch<{ Params: { courseId: string }; Body: { learningObjectives?: unknown; requirements?: unknown } }>(
    "/tenant/courses/:courseId/objectives",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const [existing] = await request.tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (!Array.isArray(body.learningObjectives) || !Array.isArray(body.requirements)) {
        return reply.code(400).send({ success: false, message: "learningObjectives and requirements must be arrays" });
      }
      const learningObjectives = body.learningObjectives.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
      const requirements = body.requirements.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);

      const [updated] = await request.tenantDb
        .update(courses)
        .set({ learningObjectives, requirements, updatedByUserId: request.user!.id, updatedAt: new Date() })
        .where(eq(courses.id, courseId))
        .returning();

      const [data] = await toResponseRows(request.tenantDb, [updated]);
      return reply.code(200).send({ success: true, data });
    },
  );

  // DELETE /tenant/courses/:courseId — courses→modules is deliberately `restrict` at the DB level
  // (this table's own original design), so a full course delete is an explicit application-level
  // cascade rather than a database `ON DELETE CASCADE`: content items → modules → authors → reviews →
  // every attachment belonging to any of those (plus the course's own image) → the course row itself.
  // The whole request already runs inside one transaction (`tenant-context.ts`), so this sequence is
  // atomic without an explicit nested transaction.
  fastify.delete<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const [existing] = await request.tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const itemRows = await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.courseId, courseId));
      for (const item of itemRows) {
        await deleteAllAttachmentsForEntity(request.tenantDb, "content_item", item.id);
      }
      const authorRows = await request.tenantDb.select({ id: courseAuthors.id }).from(courseAuthors).where(eq(courseAuthors.courseId, courseId));
      for (const author of authorRows) {
        await deleteAllAttachmentsForEntity(request.tenantDb, "course_author", author.id);
      }
      await deleteAllAttachmentsForEntity(request.tenantDb, "course", courseId);

      await request.tenantDb.delete(contentItems).where(eq(contentItems.courseId, courseId));
      await request.tenantDb.delete(courseModules).where(eq(courseModules.courseId, courseId));
      await request.tenantDb.delete(courseAuthors).where(eq(courseAuthors.courseId, courseId));
      await request.tenantDb.delete(courseReviews).where(eq(courseReviews.courseId, courseId));
      await request.tenantDb.delete(courses).where(eq(courses.id, courseId));

      return reply.code(200).send({ success: true });
    },
  );
};

export default tenantCourseRoutes;
