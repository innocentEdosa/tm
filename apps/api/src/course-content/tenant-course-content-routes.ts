import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission, requireAnyPermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseModules, contentItems } from "../db/schema/course-content";
import { users } from "../db/schema/users";
import { CONTENT_ITEM_TYPES, validateContentItemPayload, type ContentItemType } from "./content-item-payload-validation";

type ModuleRow = typeof courseModules.$inferSelect;
type ContentItemRow = typeof contentItems.$inferSelect;

interface ModuleWriteBody {
  title?: string;
  description?: string | null;
}

interface ContentItemCreateBody {
  type?: string;
  title?: string;
  description?: string | null;
  payload?: Record<string, unknown>;
}

interface ContentItemUpdateBody {
  type?: string;
  title?: string;
  description?: string | null;
  payload?: Record<string, unknown>;
  moduleId?: string;
}

/** contracts/course-content-api.md. All routes operate through `request.tenantDb` (RLS-scoped) — no
 * route ever takes or trusts a client-supplied tenant id. Reuses spec 023's `course.view`/
 * `course.manage` — no new permission keys (research.md §8). */
const tenantCourseContentRoutes: FastifyPluginAsync = async (fastify) => {
  async function buildUserById(tenantDb: typeof fastify.db, userIds: string[]) {
    const ids = Array.from(new Set(userIds));
    const rows = ids.length > 0 ? await tenantDb.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    return new Map(rows.map((u) => [u.id, u]));
  }

  function toModuleRow(m: ModuleRow, userById: Map<string, { id: string; fullName: string }>, contentItemRows?: ReturnType<typeof toContentItemRow>[]) {
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      ...(contentItemRows !== undefined ? { contentItems: contentItemRows } : {}),
      createdBy: m.createdByUserId ? (userById.get(m.createdByUserId) ?? null) : null,
      createdAt: m.createdAt,
      updatedBy: m.updatedByUserId ? (userById.get(m.updatedByUserId) ?? null) : null,
      updatedAt: m.updatedAt,
    };
  }

  function toContentItemRow(c: ContentItemRow, userById: Map<string, { id: string; fullName: string }>) {
    return {
      id: c.id,
      type: c.type,
      title: c.title,
      description: c.description,
      payload: c.payload,
      createdBy: c.createdByUserId ? (userById.get(c.createdByUserId) ?? null) : null,
      createdAt: c.createdAt,
      updatedBy: c.updatedByUserId ? (userById.get(c.updatedByUserId) ?? null) : null,
      updatedAt: c.updatedAt,
    };
  }

  async function resolveCourse(tenantDb: typeof fastify.db, courseId: string) {
    const [course] = await tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    return course ?? null;
  }

  // GET /tenant/courses/:courseId/curriculum — spec FR-002, contracts §GET curriculum.
  fastify.get<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/curriculum",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const moduleRows = await request.tenantDb.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position);
      const itemRows = await request.tenantDb.select().from(contentItems).where(eq(contentItems.courseId, courseId)).orderBy(contentItems.position);

      const userById = await buildUserById(request.tenantDb, [
        ...moduleRows.flatMap((m) => [m.createdByUserId, m.updatedByUserId]).filter((id): id is string => !!id),
        ...itemRows.flatMap((c) => [c.createdByUserId, c.updatedByUserId]).filter((id): id is string => !!id),
      ]);

      const itemsByModule = new Map<string, ContentItemRow[]>();
      for (const item of itemRows) {
        const list = itemsByModule.get(item.moduleId) ?? [];
        list.push(item);
        itemsByModule.set(item.moduleId, list);
      }

      const data = moduleRows.map((m) => toModuleRow(m, userById, (itemsByModule.get(m.id) ?? []).map((c) => toContentItemRow(c, userById))));
      return { success: true, data };
    },
  );

  // POST /tenant/courses/:courseId/modules — spec FR-001/FR-012, contracts §POST modules.
  fastify.post<{ Params: { courseId: string }; Body: ModuleWriteBody }>(
    "/tenant/courses/:courseId/modules",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const body = request.body ?? {};
      if (!body.title?.trim()) {
        return reply.code(400).send({ success: false, message: "title is required" });
      }
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const existing = await request.tenantDb.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.courseId, courseId));

      const [created] = await request.tenantDb
        .insert(courseModules)
        .values({
          tenantId: request.user!.tenantId,
          courseId,
          title: body.title.trim(),
          description: body.description ?? null,
          position: existing.length,
          createdByUserId: request.user!.id,
        })
        .returning();

      const userById = await buildUserById(request.tenantDb, [request.user!.id]);
      return reply.code(201).send({ success: true, data: toModuleRow(created, userById, []) });
    },
  );

  // PATCH /tenant/modules/:moduleId — spec FR-006/FR-012, contracts §PATCH module.
  fastify.patch<{ Params: { moduleId: string }; Body: ModuleWriteBody }>(
    "/tenant/modules/:moduleId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { moduleId } = request.params;
      const [existing] = await request.tenantDb.select().from(courseModules).where(eq(courseModules.id, moduleId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (body.title !== undefined && !body.title.trim()) {
        return reply.code(400).send({ success: false, message: "title cannot be blank" });
      }

      const [updated] = await request.tenantDb
        .update(courseModules)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          updatedByUserId: request.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(courseModules.id, moduleId))
        .returning();

      const userById = await buildUserById(request.tenantDb, [updated.createdByUserId, updated.updatedByUserId].filter((id): id is string => !!id));
      return reply.code(200).send({ success: true, data: toModuleRow(updated, userById) });
    },
  );

  // DELETE /tenant/modules/:moduleId — spec FR-009, contracts §DELETE module. Content items cascade
  // via ON DELETE CASCADE (research.md §5).
  fastify.delete<{ Params: { moduleId: string } }>(
    "/tenant/modules/:moduleId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { moduleId } = request.params;
      const [existing] = await request.tenantDb.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.id, moduleId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      await request.tenantDb.delete(courseModules).where(eq(courseModules.id, moduleId));
      return reply.code(200).send({ success: true });
    },
  );

  // POST /tenant/courses/:courseId/modules/reorder — spec FR-007, contracts §POST modules/reorder.
  fastify.post<{ Params: { courseId: string }; Body: { moduleIds?: string[] } }>(
    "/tenant/courses/:courseId/modules/reorder",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const submitted = request.body?.moduleIds ?? [];
      const current = await request.tenantDb.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.courseId, courseId));
      const currentIds = new Set(current.map((m) => m.id));
      const submittedIds = new Set(submitted);
      const exactMatch = submitted.length === current.length && submitted.every((id) => currentIds.has(id)) && current.every((m) => submittedIds.has(m.id));
      if (!exactMatch) {
        return reply.code(422).send({ success: false, message: "moduleIds must exactly match the course's current module set" });
      }

      for (let i = 0; i < submitted.length; i++) {
        await request.tenantDb.update(courseModules).set({ position: i }).where(eq(courseModules.id, submitted[i]));
      }

      const reordered = await request.tenantDb.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(courseModules.position);
      const userById = await buildUserById(request.tenantDb, reordered.flatMap((m) => [m.createdByUserId, m.updatedByUserId]).filter((id): id is string => !!id));
      return reply.code(200).send({ success: true, data: reordered.map((m) => toModuleRow(m, userById)) });
    },
  );

  // POST /tenant/modules/:moduleId/content-items — spec FR-003/FR-004/FR-005/FR-012, contracts §POST content-items.
  fastify.post<{ Params: { moduleId: string }; Body: ContentItemCreateBody }>(
    "/tenant/modules/:moduleId/content-items",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { moduleId } = request.params;
      const body = request.body ?? {};
      if (!body.type || !body.title?.trim()) {
        return reply.code(400).send({ success: false, message: "type and title are required" });
      }
      if (!CONTENT_ITEM_TYPES.includes(body.type as ContentItemType)) {
        return reply.code(422).send({ success: false, message: "Invalid type" });
      }
      const validation = validateContentItemPayload(body.type as ContentItemType, body.payload);
      if (validation.error) {
        return reply.code(422).send({ success: false, message: validation.error });
      }

      const [module] = await request.tenantDb.select().from(courseModules).where(eq(courseModules.id, moduleId));
      if (!module) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const existing = await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, moduleId));

      const [created] = await request.tenantDb
        .insert(contentItems)
        .values({
          tenantId: request.user!.tenantId,
          courseId: module.courseId,
          moduleId,
          type: body.type,
          title: body.title.trim(),
          description: body.description ?? null,
          payload: body.payload ?? {},
          position: existing.length,
          createdByUserId: request.user!.id,
        })
        .returning();

      const userById = await buildUserById(request.tenantDb, [request.user!.id]);
      return reply.code(201).send({ success: true, data: toContentItemRow(created, userById) });
    },
  );

  // PATCH /tenant/content-items/:contentItemId — spec FR-006/FR-008/FR-012, contracts §PATCH content-item.
  fastify.patch<{ Params: { contentItemId: string }; Body: ContentItemUpdateBody }>(
    "/tenant/content-items/:contentItemId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const [existing] = await request.tenantDb.select().from(contentItems).where(eq(contentItems.id, contentItemId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (body.type !== undefined) {
        return reply.code(422).send({ success: false, message: "type cannot be changed once created" });
      }
      if (body.title !== undefined && !body.title.trim()) {
        return reply.code(400).send({ success: false, message: "title cannot be blank" });
      }
      if (body.payload !== undefined) {
        const validation = validateContentItemPayload(existing.type as ContentItemType, body.payload);
        if (validation.error) {
          return reply.code(422).send({ success: false, message: validation.error });
        }
      }

      let newPosition: number | undefined;
      if (body.moduleId !== undefined && body.moduleId !== existing.moduleId) {
        const [targetModule] = await request.tenantDb.select().from(courseModules).where(eq(courseModules.id, body.moduleId));
        if (!targetModule) {
          return reply.code(404).send({ success: false, message: "Target module not found" });
        }
        if (targetModule.courseId !== existing.courseId) {
          return reply.code(422).send({ success: false, message: "Cannot move a content item to a module in a different course" });
        }
        const targetSiblings = await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, body.moduleId));
        newPosition = targetSiblings.length;
      }

      const [updated] = await request.tenantDb
        .update(contentItems)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.payload !== undefined ? { payload: body.payload } : {}),
          ...(body.moduleId !== undefined && body.moduleId !== existing.moduleId ? { moduleId: body.moduleId, position: newPosition } : {}),
          updatedByUserId: request.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(contentItems.id, contentItemId))
        .returning();

      const userById = await buildUserById(request.tenantDb, [updated.createdByUserId, updated.updatedByUserId].filter((id): id is string => !!id));
      return reply.code(200).send({ success: true, data: toContentItemRow(updated, userById) });
    },
  );

  // DELETE /tenant/content-items/:contentItemId — spec FR-009, contracts §DELETE content-item.
  fastify.delete<{ Params: { contentItemId: string } }>(
    "/tenant/content-items/:contentItemId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const [existing] = await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentItemId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      await request.tenantDb.delete(contentItems).where(eq(contentItems.id, contentItemId));
      return reply.code(200).send({ success: true });
    },
  );

  // POST /tenant/modules/:moduleId/content-items/reorder — spec FR-007, contracts §POST content-items/reorder.
  fastify.post<{ Params: { moduleId: string }; Body: { contentItemIds?: string[] } }>(
    "/tenant/modules/:moduleId/content-items/reorder",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { moduleId } = request.params;
      const [module] = await request.tenantDb.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.id, moduleId));
      if (!module) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const submitted = request.body?.contentItemIds ?? [];
      const current = await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, moduleId));
      const currentIds = new Set(current.map((c) => c.id));
      const submittedIds = new Set(submitted);
      const exactMatch = submitted.length === current.length && submitted.every((id) => currentIds.has(id)) && current.every((c) => submittedIds.has(c.id));
      if (!exactMatch) {
        return reply.code(422).send({ success: false, message: "contentItemIds must exactly match the module's current content-item set" });
      }

      for (let i = 0; i < submitted.length; i++) {
        await request.tenantDb.update(contentItems).set({ position: i }).where(eq(contentItems.id, submitted[i]));
      }

      const reordered = await request.tenantDb.select().from(contentItems).where(eq(contentItems.moduleId, moduleId)).orderBy(contentItems.position);
      const userById = await buildUserById(request.tenantDb, reordered.flatMap((c) => [c.createdByUserId, c.updatedByUserId]).filter((id): id is string => !!id));
      return reply.code(200).send({ success: true, data: reordered.map((c) => toContentItemRow(c, userById)) });
    },
  );
};

export default tenantCourseContentRoutes;
