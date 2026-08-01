import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission, requireAnyPermission } from "../permissions/require-permission";
import { contentItems } from "../db/schema/course-content";
import { courses } from "../db/schema/courses";
import { courseAuthors } from "../db/schema/course-authors";
import { fileAttachments } from "../db/schema/file-attachments";
import { users } from "../db/schema/users";
import { validateAgainstAllowlist } from "./attachment-allowlist";
import * as storage from "../storage/storage";
import { resolveTenantStorageFolder } from "../storage/tenant-storage-path";
import type { Db } from "../db/client";

type FileAttachmentRow = typeof fileAttachments.$inferSelect;

interface CreateAttachmentBody {
  /** Defaults to `"file"` (the original, presigned-upload flow) when omitted. `"link"` skips storage
   * entirely — a plain external URL, `status:'ready'` immediately. */
  kind?: "file" | "link";
  /** The file's original name (`kind:"file"`) or the link's display title (`kind:"link"`) — one field
   * doing double duty as "this attachment's title" either way. */
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  url?: string;
}

/**
 * data-model.md / research.md §9. Deletes every attachment belonging to a given entity — both the R2
 * objects and the rows — in one call. Wired into content-item, course-author, and course delete
 * (which also cascades through its content items). Trusts its caller to have already checked
 * permission — this function has no `request`/user context of its own to check against. A `link`-kind
 * row has no `storageKey` (nothing was ever uploaded to R2 for it) — only `file`-kind rows need a
 * `deleteObject` call.
 */
export async function deleteAllAttachmentsForEntity(
  tenantDb: Db,
  entityType: string,
  entityId: string,
): Promise<void> {
  const rows = await tenantDb
    .select({ id: fileAttachments.id, storageKey: fileAttachments.storageKey })
    .from(fileAttachments)
    .where(and(eq(fileAttachments.entityType, entityType), eq(fileAttachments.entityId, entityId)));

  for (const row of rows) {
    if (row.storageKey) {
      await storage.deleteObject(row.storageKey);
    }
  }
  if (rows.length > 0) {
    await tenantDb.delete(fileAttachments).where(inArray(fileAttachments.id, rows.map((r) => r.id)));
  }
}

/** contracts/file-attachment-api.md. All routes operate through `request.tenantDb` (RLS-scoped) — no
 * route ever takes or trusts a client-supplied tenant id. Reuses `course.view`/`course.manage` — no
 * new permission keys (research.md §8's spec, FR-011). */
const tenantAttachmentRoutes: FastifyPluginAsync = async (fastify) => {
  async function toResponseRow(tenantDb: typeof fastify.db, row: FileAttachmentRow) {
    let createdBy: { id: string; fullName: string } | null = null;
    if (row.createdByUserId) {
      const [u] = await tenantDb.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.id, row.createdByUserId));
      createdBy = u ?? null;
    }
    return {
      id: row.id,
      kind: row.kind,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      url: row.url,
      status: row.status,
      createdBy,
      createdAt: row.createdAt,
    };
  }

  async function resolveContentItem(tenantDb: typeof fastify.db, contentItemId: string) {
    const [item] = await tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentItemId));
    return item ?? null;
  }

  // POST /tenant/content-items/:contentItemId/attachments — spec FR-001/FR-002/FR-005/FR-012, contracts
  // §POST. Extended with a `kind:"link"` variant (a lesson resource can be a plain external URL, no
  // file) that skips the presigned-upload dance entirely and inserts directly as `status:'ready'`.
  fastify.post<{ Params: { contentItemId: string }; Body: CreateAttachmentBody }>(
    "/tenant/content-items/:contentItemId/attachments",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const body = request.body ?? {};

      const item = await resolveContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      if (body.kind === "link") {
        if (!body.fileName?.trim() || !body.url?.trim()) {
          return reply.code(400).send({ success: false, message: "fileName and url are required" });
        }
        const [created] = await request.tenantDb
          .insert(fileAttachments)
          .values({
            tenantId: request.user!.tenantId,
            entityType: "content_item",
            entityId: contentItemId,
            kind: "link",
            fileName: body.fileName.trim(),
            url: body.url.trim(),
            status: "ready",
            createdByUserId: request.user!.id,
          })
          .returning();
        return reply.code(201).send({ success: true, data: await toResponseRow(request.tenantDb, created) });
      }

      if (!storage.isStorageConfigured()) {
        return reply.code(503).send({ success: false, message: "Storage is not configured" });
      }
      if (!body.fileName?.trim() || !body.contentType?.trim() || body.sizeBytes === undefined || body.sizeBytes <= 0) {
        return reply.code(400).send({ success: false, message: "fileName, contentType, and a positive sizeBytes are required" });
      }

      const validation = validateAgainstAllowlist("content_item", body.contentType, body.sizeBytes);
      if (validation.error) {
        return reply.code(422).send({ success: false, message: validation.error });
      }

      const attachmentId = randomUUID();
      const tenantFolder = await resolveTenantStorageFolder(request.tenantDb, request.user!.tenantId);
      const storageKey = `${tenantFolder}/content_item/${contentItemId}/${attachmentId}/${body.fileName.trim()}`;

      const [created] = await request.tenantDb
        .insert(fileAttachments)
        .values({
          id: attachmentId,
          tenantId: request.user!.tenantId,
          entityType: "content_item",
          entityId: contentItemId,
          kind: "file",
          fileName: body.fileName.trim(),
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey,
          status: "pending",
          createdByUserId: request.user!.id,
        })
        .returning();

      const uploadUrl = await storage.createPresignedUploadUrl(created.storageKey!, created.contentType!, created.sizeBytes!);
      return reply.code(201).send({ success: true, data: { id: created.id, uploadUrl } });
    },
  );

  // POST /tenant/courses/:courseId/image — course-image upload, mirroring the content-item file-upload
  // flow above (`entity_type: "course"`). A course only ever has one current image — any prior one is
  // deleted first (R2 object + row) before minting the new pending row + presigned upload URL.
  fastify.post<{ Params: { courseId: string }; Body: { fileName?: string; contentType?: string; sizeBytes?: number } }>(
    "/tenant/courses/:courseId/image",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      if (!storage.isStorageConfigured()) {
        return reply.code(503).send({ success: false, message: "Storage is not configured" });
      }
      const { courseId } = request.params;
      const body = request.body ?? {};
      if (!body.fileName?.trim() || !body.contentType?.trim() || body.sizeBytes === undefined || body.sizeBytes <= 0) {
        return reply.code(400).send({ success: false, message: "fileName, contentType, and a positive sizeBytes are required" });
      }

      const [course] = await request.tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const validation = validateAgainstAllowlist("course", body.contentType, body.sizeBytes);
      if (validation.error) {
        return reply.code(422).send({ success: false, message: validation.error });
      }

      await deleteAllAttachmentsForEntity(request.tenantDb, "course", courseId);

      const attachmentId = randomUUID();
      const tenantFolder = await resolveTenantStorageFolder(request.tenantDb, request.user!.tenantId);
      const storageKey = `${tenantFolder}/course/${courseId}/${attachmentId}/${body.fileName.trim()}`;

      const [created] = await request.tenantDb
        .insert(fileAttachments)
        .values({
          id: attachmentId,
          tenantId: request.user!.tenantId,
          entityType: "course",
          entityId: courseId,
          kind: "file",
          fileName: body.fileName.trim(),
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey,
          status: "pending",
          createdByUserId: request.user!.id,
        })
        .returning();

      const uploadUrl = await storage.createPresignedUploadUrl(created.storageKey!, created.contentType!, created.sizeBytes!);
      return reply.code(201).send({ success: true, data: { id: created.id, uploadUrl } });
    },
  );

  // POST /tenant/course-authors/:authorId/image — author profile-image upload, same pattern as the
  // course-image route above (`entity_type: "course_author"`, single current image, prior one
  // deleted first).
  fastify.post<{ Params: { authorId: string }; Body: { fileName?: string; contentType?: string; sizeBytes?: number } }>(
    "/tenant/course-authors/:authorId/image",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      if (!storage.isStorageConfigured()) {
        return reply.code(503).send({ success: false, message: "Storage is not configured" });
      }
      const { authorId } = request.params;
      const body = request.body ?? {};
      if (!body.fileName?.trim() || !body.contentType?.trim() || body.sizeBytes === undefined || body.sizeBytes <= 0) {
        return reply.code(400).send({ success: false, message: "fileName, contentType, and a positive sizeBytes are required" });
      }

      const [author] = await request.tenantDb.select({ id: courseAuthors.id }).from(courseAuthors).where(eq(courseAuthors.id, authorId));
      if (!author) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const validation = validateAgainstAllowlist("course_author", body.contentType, body.sizeBytes);
      if (validation.error) {
        return reply.code(422).send({ success: false, message: validation.error });
      }

      await deleteAllAttachmentsForEntity(request.tenantDb, "course_author", authorId);

      const attachmentId = randomUUID();
      const tenantFolder = await resolveTenantStorageFolder(request.tenantDb, request.user!.tenantId);
      const storageKey = `${tenantFolder}/course_author/${authorId}/${attachmentId}/${body.fileName.trim()}`;

      const [created] = await request.tenantDb
        .insert(fileAttachments)
        .values({
          id: attachmentId,
          tenantId: request.user!.tenantId,
          entityType: "course_author",
          entityId: authorId,
          kind: "file",
          fileName: body.fileName.trim(),
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey,
          status: "pending",
          createdByUserId: request.user!.id,
        })
        .returning();

      const uploadUrl = await storage.createPresignedUploadUrl(created.storageKey!, created.contentType!, created.sizeBytes!);
      return reply.code(201).send({ success: true, data: { id: created.id, uploadUrl } });
    },
  );

  // POST /tenant/attachments/:attachmentId/confirm — spec FR-004, contracts §POST confirm. Only ever
  // applies to a `kind:"file"` row — a `kind:"link"` row is already `status:'ready'` from creation.
  fastify.post<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId/confirm",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (existing.kind !== "file" || !existing.storageKey) {
        return reply.code(422).send({ success: false, message: "Only file attachments can be confirmed" });
      }

      const head = await storage.headObject(existing.storageKey);
      if (!head.exists || head.sizeBytes !== existing.sizeBytes) {
        return reply.code(409).send({ success: false, message: "Upload not found in storage, or size mismatch" });
      }

      const [updated] = await request.tenantDb
        .update(fileAttachments)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(fileAttachments.id, attachmentId))
        .returning();

      return reply.code(200).send({ success: true, data: await toResponseRow(request.tenantDb, updated) });
    },
  );

  // GET /tenant/content-items/:contentItemId/attachments — spec FR-006, contracts §GET list.
  fastify.get<{ Params: { contentItemId: string } }>(
    "/tenant/content-items/:contentItemId/attachments",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const item = await resolveContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const ready = await request.tenantDb
        .select()
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.entityType, "content_item"),
            eq(fileAttachments.entityId, contentItemId),
            eq(fileAttachments.status, "ready"),
          ),
        )
        .orderBy(fileAttachments.createdAt);

      const data = await Promise.all(ready.map((r) => toResponseRow(request.tenantDb, r)));
      return { success: true, data };
    },
  );

  // GET /tenant/attachments/:attachmentId/download-url — spec FR-007, contracts §GET download-url. A
  // `kind:"link"` row has no object to sign a URL for — its `url` field already is the destination.
  fastify.get<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId/download-url",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing || existing.status !== "ready") {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const downloadUrl = existing.kind === "link" ? existing.url! : await storage.createPresignedDownloadUrl(existing.storageKey!);
      return { success: true, data: { downloadUrl } };
    },
  );

  // DELETE /tenant/attachments/:attachmentId — spec FR-008, contracts §DELETE. A `kind:"link"` row has
  // no R2 object to delete — just the row.
  fastify.delete<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      if (existing.storageKey) {
        await storage.deleteObject(existing.storageKey);
      }
      await request.tenantDb.delete(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      return reply.code(200).send({ success: true });
    },
  );
};

export default tenantAttachmentRoutes;
