import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, desc } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { courses } from "../db/schema/courses";
import { courseAuthors } from "../db/schema/course-authors";
import { fileAttachments } from "../db/schema/file-attachments";
import { users } from "../db/schema/users";
import { deleteAllAttachmentsForEntity } from "../attachments/tenant-attachment-routes";
import * as storage from "../storage/storage";
import { isCourseVisibleToCaller } from "./tenant-course-routes";

type CourseAuthorRow = typeof courseAuthors.$inferSelect;

interface CreateAuthorBody {
  name?: string;
  email?: string;
  roleOrDescription?: string | null;
}

/** Course Authors panel — new schema/routes added alongside the course-authoring wiring pass, no
 * matching spec doc yet. All routes operate through `request.tenantDb` (RLS-scoped) — no route ever
 * takes or trusts a client-supplied tenant id. Reuses `course.view`/`course.manage` — no new
 * permission keys, same pattern as every other course-editor resource. */
const tenantCourseAuthorRoutes: FastifyPluginAsync = async (fastify) => {
  async function resolveCourse(tenantDb: typeof fastify.db, courseId: string) {
    const [course] = await tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    return course ?? null;
  }

  /** Batch-resolves each author's current profile image to a fresh presigned download URL — same
   * approach as `tenant-course-routes.ts`'s course-image resolution. */
  async function toResponseRows(tenantDb: typeof fastify.db, rows: CourseAuthorRow[]) {
    const authorIds = rows.map((r) => r.id);
    const userIds = Array.from(new Set(rows.map((r) => r.addedByUserId).filter((id): id is string => !!id)));
    const userRows =
      userIds.length > 0
        ? await tenantDb.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, userIds))
        : [];
    const userById = new Map(userRows.map((u) => [u.id, u]));

    const imageAttachments =
      authorIds.length > 0
        ? await tenantDb
            .select({ entityId: fileAttachments.entityId, storageKey: fileAttachments.storageKey })
            .from(fileAttachments)
            .where(and(eq(fileAttachments.entityType, "course_author"), inArray(fileAttachments.entityId, authorIds), eq(fileAttachments.status, "ready")))
            .orderBy(desc(fileAttachments.createdAt))
        : [];
    const imageKeyByAuthorId = new Map<string, string>();
    for (const a of imageAttachments) {
      if (!imageKeyByAuthorId.has(a.entityId) && a.storageKey) {
        imageKeyByAuthorId.set(a.entityId, a.storageKey);
      }
    }
    const imageUrlByAuthorId = new Map<string, string>();
    if (imageKeyByAuthorId.size > 0 && storage.isStorageConfigured()) {
      await Promise.all(
        Array.from(imageKeyByAuthorId.entries()).map(async ([authorId, key]) => {
          imageUrlByAuthorId.set(authorId, await storage.createPresignedDownloadUrl(key));
        }),
      );
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      roleOrDescription: r.roleOrDescription,
      profileImageUrl: imageUrlByAuthorId.get(r.id) ?? null,
      addedBy: r.addedByUserId ? (userById.get(r.addedByUserId) ?? null) : null,
      createdAt: r.createdAt,
    }));
  }

  // GET /tenant/courses/:courseId/authors
  fastify.get<{ Params: { courseId: string } }>(
    "/tenant/courses/:courseId/authors",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { courseId } = request.params;
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      // Any authenticated tenant user may reach this route now ("My Learning" is open to everyone) —
      // see `tenant-course-content-routes.ts`'s curriculum route for the identical reasoning.
      if (!(await isCourseVisibleToCaller(request.tenantDb, request.user!.id, courseId))) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      const rows = await request.tenantDb.select().from(courseAuthors).where(eq(courseAuthors.courseId, courseId)).orderBy(desc(courseAuthors.createdAt));
      return { success: true, data: await toResponseRows(request.tenantDb, rows) };
    },
  );

  // POST /tenant/courses/:courseId/authors
  fastify.post<{ Params: { courseId: string }; Body: CreateAuthorBody }>(
    "/tenant/courses/:courseId/authors",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const body = request.body ?? {};
      if (!body.name?.trim() || !body.email?.trim()) {
        return reply.code(400).send({ success: false, message: "name and email are required" });
      }
      const course = await resolveCourse(request.tenantDb, courseId);
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const [created] = await request.tenantDb
        .insert(courseAuthors)
        .values({
          tenantId: request.user!.tenantId,
          courseId,
          name: body.name.trim(),
          email: body.email.trim(),
          roleOrDescription: body.roleOrDescription?.trim() || null,
          addedByUserId: request.user!.id,
        })
        .returning();

      const [data] = await toResponseRows(request.tenantDb, [created]);
      return reply.code(201).send({ success: true, data });
    },
  );

  // DELETE /tenant/course-authors/:authorId
  fastify.delete<{ Params: { authorId: string } }>(
    "/tenant/course-authors/:authorId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { authorId } = request.params;
      const [existing] = await request.tenantDb.select({ id: courseAuthors.id }).from(courseAuthors).where(eq(courseAuthors.id, authorId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      await deleteAllAttachmentsForEntity(request.tenantDb, "course_author", authorId);
      await request.tenantDb.delete(courseAuthors).where(eq(courseAuthors.id, authorId));
      return reply.code(200).send({ success: true });
    },
  );
};

export default tenantCourseAuthorRoutes;
