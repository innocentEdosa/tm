import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { platformCourses, platformCourseModules, platformCourseContentItems } from "../db/schema/platform-courses";
import { CONTENT_ITEM_TYPES, validateContentItemPayload, type ContentItemType } from "../course-content/content-item-payload-validation";
import { platformCourseHasFulfilledSelection } from "../course-marketplace/platform-course-immutability";

type ModuleRow = typeof platformCourseModules.$inferSelect;
type ContentItemRow = typeof platformCourseContentItems.$inferSelect;

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
  platformCourseModuleId?: string;
}

function toModuleRow(m: ModuleRow, contentItemRows?: ReturnType<typeof toContentItemRow>[]) {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    ...(contentItemRows !== undefined ? { contentItems: contentItemRows } : {}),
    createdBySuperAdminId: m.createdBySuperAdminId,
    createdAt: m.createdAt,
    updatedBySuperAdminId: m.updatedBySuperAdminId,
    updatedAt: m.updatedAt,
  };
}

function toContentItemRow(c: ContentItemRow) {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    description: c.description,
    payload: c.payload,
    createdBySuperAdminId: c.createdBySuperAdminId,
    createdAt: c.createdAt,
    updatedBySuperAdminId: c.updatedBySuperAdminId,
    updatedAt: c.updatedAt,
  };
}

/** contracts/platform-course-authoring-api.md §modules/§content-items. Mirrors
 * `tenant-course-content-routes.ts` exactly (spec 024's tenant equivalent) but against the
 * `platform_*` tables via `fastify.db` (no RLS/`tenant_id`), gated by `requireSuperAdminSession`, with
 * an added FR-013 immutability guard (`platformCourseHasFulfilledSelection`) on every edit/delete. */
const platformCourseContentRoutes: FastifyPluginAsync = async (fastify) => {
  async function resolvePlatformCourse(id: string) {
    const [course] = await fastify.db.select({ id: platformCourses.id }).from(platformCourses).where(eq(platformCourses.id, id));
    return course ?? null;
  }

  async function rejectIfImmutable(
    platformCourseId: string,
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ): Promise<boolean> {
    if (await platformCourseHasFulfilledSelection(request.superAdminDb!, platformCourseId)) {
      reply.code(409).send({
        success: false,
        message: "This platform course has already been selected by a tenant; its curriculum is frozen",
      });
      return true;
    }
    return false;
  }

  // POST /admin/platform-courses/:id/modules — mirrors spec 024 FR-001, append-only.
  fastify.post<{ Params: { id: string }; Body: ModuleWriteBody }>(
    "/admin/platform-courses/:id/modules",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id: platformCourseId } = request.params;
      const body = request.body ?? {};
      if (!body.title?.trim()) {
        return reply.code(400).send({ success: false, message: "title is required" });
      }
      const course = await resolvePlatformCourse(platformCourseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(platformCourseId, request, reply)) return;

      const existing = await fastify.db
        .select({ id: platformCourseModules.id })
        .from(platformCourseModules)
        .where(eq(platformCourseModules.platformCourseId, platformCourseId));

      const [created] = await fastify.db
        .insert(platformCourseModules)
        .values({
          platformCourseId,
          title: body.title.trim(),
          description: body.description ?? null,
          position: existing.length,
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      return reply.code(201).send({ success: true, data: toModuleRow(created, []) });
    },
  );

  // PATCH /admin/platform-course-modules/:id
  fastify.patch<{ Params: { id: string }; Body: ModuleWriteBody }>(
    "/admin/platform-course-modules/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id } = request.params;
      const [existing] = await fastify.db.select().from(platformCourseModules).where(eq(platformCourseModules.id, id));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(existing.platformCourseId, request, reply)) return;

      const body = request.body ?? {};
      if (body.title !== undefined && !body.title.trim()) {
        return reply.code(400).send({ success: false, message: "title cannot be blank" });
      }

      const [updated] = await fastify.db
        .update(platformCourseModules)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          updatedBySuperAdminId: request.superAdmin!.id,
          updatedAt: new Date(),
        })
        .where(eq(platformCourseModules.id, id))
        .returning();

      return reply.code(200).send({ success: true, data: toModuleRow(updated) });
    },
  );

  // DELETE /admin/platform-course-modules/:id — content items cascade via ON DELETE CASCADE.
  fastify.delete<{ Params: { id: string } }>(
    "/admin/platform-course-modules/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id } = request.params;
      const [existing] = await fastify.db.select().from(platformCourseModules).where(eq(platformCourseModules.id, id));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(existing.platformCourseId, request, reply)) return;

      await fastify.db.delete(platformCourseModules).where(eq(platformCourseModules.id, id));
      return reply.code(200).send({ success: true });
    },
  );

  // PUT /admin/platform-courses/:id/modules/reorder — complete-ordered-id-list, mirrors spec 024 FR-007.
  fastify.put<{ Params: { id: string }; Body: { moduleIds?: string[] } }>(
    "/admin/platform-courses/:id/modules/reorder",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id: platformCourseId } = request.params;
      const course = await resolvePlatformCourse(platformCourseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(platformCourseId, request, reply)) return;

      const submitted = request.body?.moduleIds ?? [];
      const current = await fastify.db
        .select({ id: platformCourseModules.id })
        .from(platformCourseModules)
        .where(eq(platformCourseModules.platformCourseId, platformCourseId));
      const currentIds = new Set(current.map((m) => m.id));
      const submittedIds = new Set(submitted);
      const exactMatch =
        submitted.length === current.length && submitted.every((sid) => currentIds.has(sid)) && current.every((m) => submittedIds.has(m.id));
      if (!exactMatch) {
        return reply.code(422).send({ success: false, message: "moduleIds must exactly match the platform course's current module set" });
      }

      for (let i = 0; i < submitted.length; i++) {
        await fastify.db.update(platformCourseModules).set({ position: i }).where(eq(platformCourseModules.id, submitted[i]));
      }

      const reordered = await fastify.db
        .select()
        .from(platformCourseModules)
        .where(eq(platformCourseModules.platformCourseId, platformCourseId))
        .orderBy(platformCourseModules.position);
      return reply.code(200).send({ success: true, data: reordered.map((m) => toModuleRow(m)) });
    },
  );

  // POST /admin/platform-course-modules/:moduleId/content-items
  fastify.post<{ Params: { moduleId: string }; Body: ContentItemCreateBody }>(
    "/admin/platform-course-modules/:moduleId/content-items",
    { preHandler: [requireSuperAdminSession] },
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

      const [module] = await fastify.db.select().from(platformCourseModules).where(eq(platformCourseModules.id, moduleId));
      if (!module) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(module.platformCourseId, request, reply)) return;

      const existing = await fastify.db
        .select({ id: platformCourseContentItems.id })
        .from(platformCourseContentItems)
        .where(eq(platformCourseContentItems.platformCourseModuleId, moduleId));

      const [created] = await fastify.db
        .insert(platformCourseContentItems)
        .values({
          platformCourseId: module.platformCourseId,
          platformCourseModuleId: moduleId,
          type: body.type,
          title: body.title.trim(),
          description: body.description ?? null,
          payload: body.payload ?? {},
          position: existing.length,
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      return reply.code(201).send({ success: true, data: toContentItemRow(created) });
    },
  );

  // PATCH /admin/platform-course-content-items/:id
  fastify.patch<{ Params: { id: string }; Body: ContentItemUpdateBody }>(
    "/admin/platform-course-content-items/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id } = request.params;
      const [existing] = await fastify.db.select().from(platformCourseContentItems).where(eq(platformCourseContentItems.id, id));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(existing.platformCourseId, request, reply)) return;

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
      if (body.platformCourseModuleId !== undefined && body.platformCourseModuleId !== existing.platformCourseModuleId) {
        const [targetModule] = await fastify.db
          .select()
          .from(platformCourseModules)
          .where(eq(platformCourseModules.id, body.platformCourseModuleId));
        if (!targetModule) {
          return reply.code(404).send({ success: false, message: "Target module not found" });
        }
        if (targetModule.platformCourseId !== existing.platformCourseId) {
          return reply.code(422).send({ success: false, message: "Cannot move a content item to a module in a different platform course" });
        }
        const targetSiblings = await fastify.db
          .select({ id: platformCourseContentItems.id })
          .from(platformCourseContentItems)
          .where(eq(platformCourseContentItems.platformCourseModuleId, body.platformCourseModuleId));
        newPosition = targetSiblings.length;
      }

      const [updated] = await fastify.db
        .update(platformCourseContentItems)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.payload !== undefined ? { payload: body.payload } : {}),
          ...(body.platformCourseModuleId !== undefined && body.platformCourseModuleId !== existing.platformCourseModuleId
            ? { platformCourseModuleId: body.platformCourseModuleId, position: newPosition }
            : {}),
          updatedBySuperAdminId: request.superAdmin!.id,
          updatedAt: new Date(),
        })
        .where(eq(platformCourseContentItems.id, id))
        .returning();

      return reply.code(200).send({ success: true, data: toContentItemRow(updated) });
    },
  );

  // DELETE /admin/platform-course-content-items/:id
  fastify.delete<{ Params: { id: string } }>(
    "/admin/platform-course-content-items/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id } = request.params;
      const [existing] = await fastify.db.select().from(platformCourseContentItems).where(eq(platformCourseContentItems.id, id));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(existing.platformCourseId, request, reply)) return;

      await fastify.db.delete(platformCourseContentItems).where(eq(platformCourseContentItems.id, id));
      return reply.code(200).send({ success: true });
    },
  );

  // PUT /admin/platform-course-modules/:id/content-items/reorder
  fastify.put<{ Params: { id: string }; Body: { contentItemIds?: string[] } }>(
    "/admin/platform-course-modules/:id/content-items/reorder",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id: moduleId } = request.params;
      const [module] = await fastify.db.select().from(platformCourseModules).where(eq(platformCourseModules.id, moduleId));
      if (!module) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(module.platformCourseId, request, reply)) return;

      const submitted = request.body?.contentItemIds ?? [];
      const current = await fastify.db
        .select({ id: platformCourseContentItems.id })
        .from(platformCourseContentItems)
        .where(eq(platformCourseContentItems.platformCourseModuleId, moduleId));
      const currentIds = new Set(current.map((c) => c.id));
      const submittedIds = new Set(submitted);
      const exactMatch =
        submitted.length === current.length && submitted.every((sid) => currentIds.has(sid)) && current.every((c) => submittedIds.has(c.id));
      if (!exactMatch) {
        return reply.code(422).send({ success: false, message: "contentItemIds must exactly match the module's current content-item set" });
      }

      for (let i = 0; i < submitted.length; i++) {
        await fastify.db.update(platformCourseContentItems).set({ position: i }).where(eq(platformCourseContentItems.id, submitted[i]));
      }

      const reordered = await fastify.db
        .select()
        .from(platformCourseContentItems)
        .where(eq(platformCourseContentItems.platformCourseModuleId, moduleId))
        .orderBy(platformCourseContentItems.position);
      return reply.code(200).send({ success: true, data: reordered.map((c) => toContentItemRow(c)) });
    },
  );
};

export default platformCourseContentRoutes;
