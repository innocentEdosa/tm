import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { platformCourses, platformCourseContentItems, platformFileAttachments } from "../db/schema/platform-courses";
import { validateAgainstAllowlist } from "../attachments/attachment-allowlist";
import { platformCourseHasFulfilledSelection } from "../course-marketplace/platform-course-immutability";
import type { Db } from "../db/client";
import * as storage from "../storage/storage";

type PlatformFileAttachmentRow = typeof platformFileAttachments.$inferSelect;

interface CreateAttachmentBody {
  /** Defaults to `"file"` when omitted — mirrors `tenant-attachment-routes.ts`'s own
   * `CreateAttachmentBody` exactly (spec 028's `kind:"link"` addition). */
  kind?: "file" | "link";
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  url?: string;
}

/**
 * Deletes every attachment belonging to a given platform entity — both the R2 objects and the
 * rows — in one call. Mirrors `tenant-attachment-routes.ts`'s `deleteAllAttachmentsForEntity`
 * exactly. Used for course-image replacement (a course only ever has one current image) and
 * content-item/module delete cascades (platform-course-content-routes.ts).
 */
export async function deleteAllAttachmentsForPlatformEntity(db: Db, entityType: string, entityId: string): Promise<void> {
  const rows = await db
    .select({ id: platformFileAttachments.id, storageKey: platformFileAttachments.storageKey })
    .from(platformFileAttachments)
    .where(and(eq(platformFileAttachments.entityType, entityType), eq(platformFileAttachments.entityId, entityId)));

  for (const row of rows) {
    if (row.storageKey) {
      await storage.deleteObject(row.storageKey);
    }
  }
  if (rows.length > 0) {
    await db.delete(platformFileAttachments).where(
      and(eq(platformFileAttachments.entityType, entityType), eq(platformFileAttachments.entityId, entityId)),
    );
  }
}

/** contracts/platform-course-authoring-api.md §attachments. Mirrors `tenant-attachment-routes.ts`
 * (spec 025, extended by spec 028's `kind:"link"`/course-image addition) against
 * `platform_file_attachments` — reuses the same fixed, platform-wide upload allowlist and
 * `StorageClient` unmodified (research.md §6). Every mutating route rejects `409` once the owning
 * platform course has ≥1 `fulfilled` selection (FR-013) — extended to cover the course image too,
 * now that `clonePlatformCourseIntoTenant` also clones it (a tenant's copy must never
 * unexpectedly change underneath it, the same rationale as content). */
const platformCourseFileRoutes: FastifyPluginAsync = async (fastify) => {
  function toResponseRow(row: PlatformFileAttachmentRow) {
    return {
      id: row.id,
      kind: row.kind,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      url: row.url,
      status: row.status,
      createdBySuperAdminId: row.createdBySuperAdminId,
      createdAt: row.createdAt,
    };
  }

  async function resolveContentItem(contentItemId: string) {
    const [item] = await fastify.db.select().from(platformCourseContentItems).where(eq(platformCourseContentItems.id, contentItemId));
    return item ?? null;
  }

  /** Resolves the platform course a given attachment's entity ultimately belongs to, for the
   * generic (entity-agnostic) confirm/delete/download-url routes below. */
  async function resolveOwningPlatformCourseId(entityType: string, entityId: string): Promise<string | null> {
    if (entityType === "platform_course") {
      return entityId;
    }
    if (entityType === "platform_content_item") {
      const item = await resolveContentItem(entityId);
      return item?.platformCourseId ?? null;
    }
    return null;
  }

  async function rejectIfImmutable(platformCourseId: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    if (await platformCourseHasFulfilledSelection(request.superAdminDb!, platformCourseId)) {
      reply.code(409).send({
        success: false,
        message: "This platform course has already been selected by a tenant; its files are frozen",
      });
      return true;
    }
    return false;
  }

  // POST /admin/platform-courses/:id/image — course-image upload, mirroring
  // `tenant-attachment-routes.ts`'s `POST /tenant/courses/:courseId/image` exactly. A course only
  // ever has one current image — any prior one is deleted first (R2 object + row).
  fastify.post<{ Params: { id: string }; Body: { fileName?: string; contentType?: string; sizeBytes?: number } }>(
    "/admin/platform-courses/:id/image",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      if (!storage.isStorageConfigured()) {
        return reply.code(503).send({ success: false, message: "Storage is not configured" });
      }
      const { id: courseId } = request.params;
      const body = request.body ?? {};
      if (!body.fileName?.trim() || !body.contentType?.trim() || body.sizeBytes === undefined || body.sizeBytes <= 0) {
        return reply.code(400).send({ success: false, message: "fileName, contentType, and a positive sizeBytes are required" });
      }

      const [course] = await fastify.db.select({ id: platformCourses.id }).from(platformCourses).where(eq(platformCourses.id, courseId));
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(courseId, request, reply)) return;

      const validation = validateAgainstAllowlist("course", body.contentType, body.sizeBytes);
      if (validation.error) {
        return reply.code(422).send({ success: false, message: validation.error });
      }

      await deleteAllAttachmentsForPlatformEntity(fastify.db, "platform_course", courseId);

      const attachmentId = randomUUID();
      const storageKey = `platform/course/${courseId}/${attachmentId}/${body.fileName.trim()}`;

      const [created] = await fastify.db
        .insert(platformFileAttachments)
        .values({
          id: attachmentId,
          entityType: "platform_course",
          entityId: courseId,
          kind: "file",
          fileName: body.fileName.trim(),
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey,
          status: "pending",
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      const uploadUrl = await storage.createPresignedUploadUrl(created.storageKey!, created.contentType!, created.sizeBytes!);
      return reply.code(201).send({ success: true, data: { id: created.id, uploadUrl } });
    },
  );

  // POST /admin/platform-course-content-items/:id/attachments — extended with a `kind:"link"`
  // variant (a lesson resource can be a plain external URL, no file), mirroring
  // `tenant-attachment-routes.ts`'s content-item route exactly.
  fastify.post<{ Params: { id: string }; Body: CreateAttachmentBody }>(
    "/admin/platform-course-content-items/:id/attachments",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id: contentItemId } = request.params;
      const body = request.body ?? {};

      const item = await resolveContentItem(contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await rejectIfImmutable(item.platformCourseId, request, reply)) return;

      if (body.kind === "link") {
        if (!body.fileName?.trim() || !body.url?.trim()) {
          return reply.code(400).send({ success: false, message: "fileName and url are required" });
        }
        const [created] = await fastify.db
          .insert(platformFileAttachments)
          .values({
            entityType: "platform_content_item",
            entityId: contentItemId,
            kind: "link",
            fileName: body.fileName.trim(),
            url: body.url.trim(),
            status: "ready",
            createdBySuperAdminId: request.superAdmin!.id,
          })
          .returning();
        return reply.code(201).send({ success: true, data: toResponseRow(created) });
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
      const storageKey = `platform/content_item/${contentItemId}/${attachmentId}/${body.fileName.trim()}`;

      const [created] = await fastify.db
        .insert(platformFileAttachments)
        .values({
          id: attachmentId,
          entityType: "platform_content_item",
          entityId: contentItemId,
          kind: "file",
          fileName: body.fileName.trim(),
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey,
          status: "pending",
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      const uploadUrl = await storage.createPresignedUploadUrl(created.storageKey!, created.contentType!, created.sizeBytes!);
      return reply.code(201).send({ success: true, data: { id: created.id, uploadUrl } });
    },
  );

  // POST /admin/platform-file-attachments/:attachmentId/confirm — generic, entity-agnostic (a
  // course image and a content-item attachment share one confirm route), mirroring
  // `tenant-attachment-routes.ts`'s `POST /tenant/attachments/:attachmentId/confirm`. Only ever
  // applies to a `kind:"file"` row — a `kind:"link"` row is already `status:'ready'` from creation.
  fastify.post<{ Params: { attachmentId: string } }>(
    "/admin/platform-file-attachments/:attachmentId/confirm",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await fastify.db.select().from(platformFileAttachments).where(eq(platformFileAttachments.id, attachmentId));
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

      const [updated] = await fastify.db
        .update(platformFileAttachments)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(platformFileAttachments.id, attachmentId))
        .returning();

      return reply.code(200).send({ success: true, data: toResponseRow(updated) });
    },
  );

  // GET /admin/platform-course-content-items/:id/attachments — unchanged path/shape, entity-scoped
  // (list stays scoped, only confirm/download-url/delete became generic — matches tenant).
  fastify.get<{ Params: { id: string } }>(
    "/admin/platform-course-content-items/:id/attachments",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id: contentItemId } = request.params;
      const item = await resolveContentItem(contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const ready = await fastify.db
        .select()
        .from(platformFileAttachments)
        .where(
          and(
            eq(platformFileAttachments.entityType, "platform_content_item"),
            eq(platformFileAttachments.entityId, contentItemId),
            eq(platformFileAttachments.status, "ready"),
          ),
        )
        .orderBy(platformFileAttachments.createdAt);

      return { success: true, data: ready.map(toResponseRow) };
    },
  );

  // GET /admin/platform-file-attachments/:attachmentId/download-url — generic, mirrors
  // `tenant-attachment-routes.ts`'s download-url route. A `kind:"link"` row has no object to sign a
  // URL for — its `url` field already is the destination.
  fastify.get<{ Params: { attachmentId: string } }>(
    "/admin/platform-file-attachments/:attachmentId/download-url",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await fastify.db.select().from(platformFileAttachments).where(eq(platformFileAttachments.id, attachmentId));
      if (!existing || existing.status !== "ready") {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const downloadUrl = existing.kind === "link" ? existing.url! : await storage.createPresignedDownloadUrl(existing.storageKey!);
      return { success: true, data: { downloadUrl } };
    },
  );

  // DELETE /admin/platform-file-attachments/:attachmentId — generic, mirrors
  // `tenant-attachment-routes.ts`'s delete route. Rejects `409` if the owning platform course
  // (resolved via the attachment's own entity, whether a course image or a content-item
  // attachment) has ≥1 fulfilled selection.
  fastify.delete<{ Params: { attachmentId: string } }>(
    "/admin/platform-file-attachments/:attachmentId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await fastify.db.select().from(platformFileAttachments).where(eq(platformFileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const owningCourseId = await resolveOwningPlatformCourseId(existing.entityType, existing.entityId);
      if (owningCourseId && (await rejectIfImmutable(owningCourseId, request, reply))) return;

      if (existing.storageKey) {
        await storage.deleteObject(existing.storageKey);
      }
      await fastify.db.delete(platformFileAttachments).where(eq(platformFileAttachments.id, attachmentId));
      return reply.code(200).send({ success: true });
    },
  );
};

export default platformCourseFileRoutes;
