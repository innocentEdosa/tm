import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { platformCourseContentItems, platformFileAttachments } from "../db/schema/platform-courses";
import { validateAgainstAllowlist } from "../attachments/attachment-allowlist";
import { platformCourseHasFulfilledSelection } from "../course-marketplace/platform-course-immutability";
import * as storage from "../storage/storage";

type PlatformFileAttachmentRow = typeof platformFileAttachments.$inferSelect;

interface CreateAttachmentBody {
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
}

function toResponseRow(row: PlatformFileAttachmentRow) {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdBySuperAdminId: row.createdBySuperAdminId,
    createdAt: row.createdAt,
  };
}

/** contracts/platform-course-authoring-api.md §attachments. Mirrors `tenant-attachment-routes.ts`
 * (spec 025) against `platform_file_attachments` — reuses the same fixed, platform-wide upload
 * allowlist (`content_item` entity type) and `StorageClient` unmodified (research.md §6). Every
 * mutating route rejects `409` once the owning platform course has ≥1 `fulfilled` selection
 * (FR-013). */
const platformCourseFileRoutes: FastifyPluginAsync = async (fastify) => {
  async function resolveContentItem(contentItemId: string) {
    const [item] = await fastify.db
      .select()
      .from(platformCourseContentItems)
      .where(eq(platformCourseContentItems.id, contentItemId));
    return item ?? null;
  }

  // POST /admin/platform-course-content-items/:id/attachments/upload-url
  fastify.post<{ Params: { id: string }; Body: CreateAttachmentBody }>(
    "/admin/platform-course-content-items/:id/attachments/upload-url",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      if (!storage.isStorageConfigured()) {
        return reply.code(503).send({ success: false, message: "Storage is not configured" });
      }

      const { id: contentItemId } = request.params;
      const body = request.body ?? {};
      if (!body.fileName?.trim() || !body.contentType?.trim() || body.sizeBytes === undefined || body.sizeBytes <= 0) {
        return reply.code(400).send({ success: false, message: "fileName, contentType, and a positive sizeBytes are required" });
      }

      const item = await resolveContentItem(contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await platformCourseHasFulfilledSelection(request.superAdminDb!, item.platformCourseId)) {
        return reply.code(409).send({
          success: false,
          message: "This platform course has already been selected by a tenant; its files are frozen",
        });
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
          fileName: body.fileName.trim(),
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey,
          status: "pending",
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      const uploadUrl = await storage.createPresignedUploadUrl(created.storageKey, created.contentType, created.sizeBytes);
      return reply.code(201).send({ success: true, data: { id: created.id, uploadUrl } });
    },
  );

  // POST /admin/platform-course-content-items/:id/attachments/:attachmentId/confirm
  fastify.post<{ Params: { id: string; attachmentId: string } }>(
    "/admin/platform-course-content-items/:id/attachments/:attachmentId/confirm",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await fastify.db.select().from(platformFileAttachments).where(eq(platformFileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
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

  // GET /admin/platform-course-content-items/:id/attachments
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

  // DELETE /admin/platform-course-content-items/:id/attachments/:attachmentId
  fastify.delete<{ Params: { id: string; attachmentId: string } }>(
    "/admin/platform-course-content-items/:id/attachments/:attachmentId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { id: contentItemId, attachmentId } = request.params;
      const item = await resolveContentItem(contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (await platformCourseHasFulfilledSelection(request.superAdminDb!, item.platformCourseId)) {
        return reply.code(409).send({
          success: false,
          message: "This platform course has already been selected by a tenant; its files are frozen",
        });
      }

      const [existing] = await fastify.db.select().from(platformFileAttachments).where(eq(platformFileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      await storage.deleteObject(existing.storageKey);
      await fastify.db.delete(platformFileAttachments).where(eq(platformFileAttachments.id, attachmentId));
      return reply.code(200).send({ success: true });
    },
  );
};

export default platformCourseFileRoutes;
