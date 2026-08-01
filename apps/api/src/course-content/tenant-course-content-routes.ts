import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission, requireAnyPermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseModules, contentItems } from "../db/schema/course-content";
import { users } from "../db/schema/users";
import { deleteAllAttachmentsForEntity } from "../attachments/tenant-attachment-routes";
import { CONTENT_ITEM_TYPES, validateContentItemPayload, type ContentItemType } from "./content-item-payload-validation";

type ModuleRow = typeof courseModules.$inferSelect;
type ContentItemRow = typeof contentItems.$inferSelect;

const STATUSES = ["draft", "published"] as const;
type Status = (typeof STATUSES)[number];

interface ModuleWriteBody {
  title?: string;
  description?: string | null;
  /** Independent of the parent course's own draft/active/archived status. */
  status?: Status;
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
  /** `undefined` = unchanged; a module id = move into that module; `null` = move to standalone
   * (course-level, no module) — an explicit key with a `null` value, not merely omitted. */
  moduleId?: string | null;
  /** Independent of the parent course's own status. */
  status?: Status;
}

/** contracts/course-content-api.md, extended for standalone (module-less) lessons. All routes operate
 * through `request.tenantDb` (RLS-scoped) — no route ever takes or trusts a client-supplied tenant id.
 * Reuses spec 023's `course.view`/`course.manage` — no new permission keys (research.md §8). */
const tenantCourseContentRoutes: FastifyPluginAsync = async (fastify) => {
  async function buildUserById(tenantDb: typeof fastify.db, userIds: string[]) {
    const ids = Array.from(new Set(userIds));
    const rows = ids.length > 0 ? await tenantDb.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    return new Map(rows.map((u) => [u.id, u]));
  }

  /** A course's top-level outline (`courses.outlineOrder`) always contains module ids and standalone
   * content-item ids only — never a module-scoped item's id. Appending/removing here is a single
   * atomic `array_append`/`array_remove` rather than a read-modify-write, so it can't race with a
   * concurrent reorder. */
  async function appendToOutlineOrder(tenantDb: typeof fastify.db, courseId: string, id: string) {
    await tenantDb.update(courses).set({ outlineOrder: sql`array_append(${courses.outlineOrder}, ${id})` }).where(eq(courses.id, courseId));
  }

  async function removeFromOutlineOrder(tenantDb: typeof fastify.db, courseId: string, id: string) {
    await tenantDb.update(courses).set({ outlineOrder: sql`array_remove(${courses.outlineOrder}, ${id})` }).where(eq(courses.id, courseId));
  }

  function toModuleRow(m: ModuleRow, userById: Map<string, { id: string; fullName: string }>, contentItemRows?: ReturnType<typeof toContentItemRow>[]) {
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      status: m.status,
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
      status: c.status,
      createdBy: c.createdByUserId ? (userById.get(c.createdByUserId) ?? null) : null,
      createdAt: c.createdAt,
      updatedBy: c.updatedByUserId ? (userById.get(c.updatedByUserId) ?? null) : null,
      updatedAt: c.updatedAt,
    };
  }

  async function resolveCourse(tenantDb: typeof fastify.db, courseId: string) {
    const [course] = await tenantDb.select({ id: courses.id, outlineOrder: courses.outlineOrder }).from(courses).where(eq(courses.id, courseId));
    return course ?? null;
  }

  // GET /tenant/courses/:courseId/curriculum — spec FR-002, contracts §GET curriculum, extended to
  // also return standalone (module-less) content items and the course's outlineOrder — the frontend
  // combines `modules` + `standaloneContentItems` using `outlineOrder` to render one interleaved
  // outline (a direct port of the mock UI's own `useMockCourseOutline`).
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
      const standaloneItems: ContentItemRow[] = [];
      for (const item of itemRows) {
        if (item.moduleId === null) {
          standaloneItems.push(item);
          continue;
        }
        const list = itemsByModule.get(item.moduleId) ?? [];
        list.push(item);
        itemsByModule.set(item.moduleId, list);
      }

      const modules = moduleRows.map((m) => toModuleRow(m, userById, (itemsByModule.get(m.id) ?? []).map((c) => toContentItemRow(c, userById))));
      const standaloneContentItems = standaloneItems.map((c) => toContentItemRow(c, userById));
      return { success: true, data: { modules, standaloneContentItems, outlineOrder: course.outlineOrder } };
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
      await appendToOutlineOrder(request.tenantDb, courseId, created.id);

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
      if (body.status !== undefined && !STATUSES.includes(body.status)) {
        return reply.code(422).send({ success: false, message: "Invalid status" });
      }

      const [updated] = await request.tenantDb
        .update(courseModules)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
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
  // via ON DELETE CASCADE (research.md §5); each one's attachments are cleaned up explicitly first
  // (the DB cascade only deletes the content_items rows, not their file_attachments).
  fastify.delete<{ Params: { moduleId: string } }>(
    "/tenant/modules/:moduleId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { moduleId } = request.params;
      const [existing] = await request.tenantDb.select().from(courseModules).where(eq(courseModules.id, moduleId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const itemRows = await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, moduleId));
      for (const item of itemRows) {
        await deleteAllAttachmentsForEntity(request.tenantDb, "content_item", item.id);
      }
      await request.tenantDb.delete(courseModules).where(eq(courseModules.id, moduleId));
      await removeFromOutlineOrder(request.tenantDb, existing.courseId, moduleId);
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

  // POST /tenant/courses/:courseId/outline/reorder — the course's top-level outline (modules and
  // standalone lessons interleaved in one order). Same exact-set-match validation style as the
  // module/content-item reorder endpoints above, just validated against modules ∪ standalone items
  // instead of a single container's children.
  fastify.post<{ Params: { courseId: string }; Body: { orderedIds?: string[] } }>(
    "/tenant/courses/:courseId/outline/reorder",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const submitted = request.body?.orderedIds ?? [];
      const moduleIds = (await request.tenantDb.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.courseId, courseId))).map((m) => m.id);
      const standaloneIds = (
        await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.courseId, courseId), isNull(contentItems.moduleId)))
      ).map((c) => c.id);
      const currentIds = new Set([...moduleIds, ...standaloneIds]);
      const submittedIds = new Set(submitted);
      const exactMatch = submitted.length === currentIds.size && submitted.every((id) => currentIds.has(id)) && Array.from(currentIds).every((id) => submittedIds.has(id));
      if (!exactMatch) {
        return reply.code(422).send({ success: false, message: "orderedIds must exactly match the course's current module and standalone-lesson ids" });
      }

      const [updated] = await request.tenantDb.update(courses).set({ outlineOrder: submitted }).where(eq(courses.id, courseId)).returning({ outlineOrder: courses.outlineOrder });
      return reply.code(200).send({ success: true, data: { outlineOrder: updated.outlineOrder } });
    },
  );

  // POST /tenant/courses/:courseId/content-items — a standalone (module-less) lesson, living directly
  // at the course's top level. Same type/payload validation as the module-scoped create below;
  // appends its id to the course's outlineOrder instead of a module's contentItemIds.
  fastify.post<{ Params: { courseId: string }; Body: ContentItemCreateBody }>(
    "/tenant/courses/:courseId/content-items",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
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

      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const existingStandalone = await request.tenantDb
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(and(eq(contentItems.courseId, courseId), isNull(contentItems.moduleId)));

      const [created] = await request.tenantDb
        .insert(contentItems)
        .values({
          tenantId: request.user!.tenantId,
          courseId,
          moduleId: null,
          type: body.type,
          title: body.title.trim(),
          description: body.description ?? null,
          payload: body.payload ?? {},
          position: existingStandalone.length,
          createdByUserId: request.user!.id,
        })
        .returning();
      await appendToOutlineOrder(request.tenantDb, courseId, created.id);

      const userById = await buildUserById(request.tenantDb, [request.user!.id]);
      return reply.code(201).send({ success: true, data: toContentItemRow(created, userById) });
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
      if (body.status !== undefined && !STATUSES.includes(body.status)) {
        return reply.code(422).send({ success: false, message: "Invalid status" });
      }

      // `moduleId` can move a content item between modules (existing behavior) or, since a content
      // item can now be standalone, into/out of the course's top-level outline: `null` moves it to
      // standalone (appending to `courses.outlineOrder`); moving out of standalone into a real module
      // removes it from `outlineOrder` instead (a module-scoped item is never listed there).
      let newPosition: number | undefined;
      let outlineOrderChange: "add" | "remove" | null = null;
      if (body.moduleId !== undefined && body.moduleId !== existing.moduleId) {
        if (body.moduleId === null) {
          const standaloneSiblings = await request.tenantDb
            .select({ id: contentItems.id })
            .from(contentItems)
            .where(and(eq(contentItems.courseId, existing.courseId), isNull(contentItems.moduleId)));
          newPosition = standaloneSiblings.length;
          outlineOrderChange = "add";
        } else {
          const [targetModule] = await request.tenantDb.select().from(courseModules).where(eq(courseModules.id, body.moduleId));
          if (!targetModule) {
            return reply.code(404).send({ success: false, message: "Target module not found" });
          }
          if (targetModule.courseId !== existing.courseId) {
            return reply.code(422).send({ success: false, message: "Cannot move a content item to a module in a different course" });
          }
          const targetSiblings = await request.tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.moduleId, body.moduleId));
          newPosition = targetSiblings.length;
          if (existing.moduleId === null) {
            outlineOrderChange = "remove";
          }
        }
      }

      const [updated] = await request.tenantDb
        .update(contentItems)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.payload !== undefined ? { payload: body.payload } : {}),
          ...(body.moduleId !== undefined && body.moduleId !== existing.moduleId ? { moduleId: body.moduleId, position: newPosition } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          updatedByUserId: request.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(contentItems.id, contentItemId))
        .returning();

      if (outlineOrderChange === "add") {
        await appendToOutlineOrder(request.tenantDb, existing.courseId, contentItemId);
      } else if (outlineOrderChange === "remove") {
        await removeFromOutlineOrder(request.tenantDb, existing.courseId, contentItemId);
      }

      const userById = await buildUserById(request.tenantDb, [updated.createdByUserId, updated.updatedByUserId].filter((id): id is string => !!id));
      return reply.code(200).send({ success: true, data: toContentItemRow(updated, userById) });
    },
  );

  // DELETE /tenant/content-items/:contentItemId — spec FR-009, contracts §DELETE content-item. Its
  // attachments are explicitly cleaned up first (research.md §9's `deleteAllAttachmentsForEntity`,
  // previously unwired); a standalone item is also removed from `courses.outlineOrder`.
  fastify.delete<{ Params: { contentItemId: string } }>(
    "/tenant/content-items/:contentItemId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const [existing] = await request.tenantDb.select().from(contentItems).where(eq(contentItems.id, contentItemId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      await deleteAllAttachmentsForEntity(request.tenantDb, "content_item", contentItemId);
      await request.tenantDb.delete(contentItems).where(eq(contentItems.id, contentItemId));
      if (existing.moduleId === null) {
        await removeFromOutlineOrder(request.tenantDb, existing.courseId, contentItemId);
      }
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
