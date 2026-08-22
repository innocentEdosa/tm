import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { contentItems } from "../db/schema/course-content";
import { fileAttachments } from "../db/schema/file-attachments";
import { validateAgainstAllowlist, validateVideoFileExtension } from "./attachment-allowlist";
import { resolveContentItem, revertCourseForAttachment, toAttachmentResponseRow, abortMultipartIfPending } from "./tenant-attachment-routes";
import * as storage from "../storage/storage";
import { resolveTenantStorageFolder } from "../storage/tenant-storage-path";
import { resolveVideoUploadStrategy, computePartCount, MULTIPART_PART_SIZE_BYTES, MULTIPART_MAX_PARTS, MULTIPART_PART_BATCH_SIZE } from "../storage/multipart-config";
import type { Db } from "../db/client";

type FileAttachmentRow = typeof fileAttachments.$inferSelect;

/** Only a `type: "video"` content item can have a video uploaded to it — mirrors
 * `tenant-scorm-upload-routes.ts`'s own `resolveScormContentItem` guard. */
async function resolveVideoContentItem(tenantDb: Db, contentItemId: string) {
  const [item] = await tenantDb.select().from(contentItems).where(eq(contentItems.id, contentItemId));
  if (!item || item.type !== "video") return null;
  return item;
}

/** Video attachments and lesson-resource attachments share the same polymorphic `file_attachments`
 * row shape (`entityType: "content_item"`) with no separate table or role column — deliberately, to
 * stay inside the existing attachment lifecycle rather than fork a parallel one. They're told apart
 * by `contentType`: the `content_item` (resource) and `content_item_video` allowlists are disjoint
 * content-type sets (images/PDF vs. video/*), so "is this row a video" is simply "does its
 * content_type start with video/" — no extra column needed for that either. */
function isVideoAttachment(row: { contentType: string | null }): boolean {
  return row.contentType?.startsWith("video/") ?? false;
}

/** Cleans up any leftover `pending` video attachment(s) for this content item before starting a new
 * upload attempt — covers "retry after failure" and "start a new upload while one was abandoned"
 * without needing a background job: the natural trigger is simply the next time this content item's
 * video upload is (re)started. Aborts a dangling multipart session and best-effort deletes the R2
 * object in case a single-PUT attempt had already written bytes before being abandoned. */
async function cleanupStalePendingVideo(tenantDb: Db, contentItemId: string): Promise<void> {
  const stale = await tenantDb
    .select()
    .from(fileAttachments)
    .where(and(eq(fileAttachments.entityType, "content_item"), eq(fileAttachments.entityId, contentItemId), eq(fileAttachments.status, "pending")));
  const staleVideoRows = stale.filter(isVideoAttachment);
  if (staleVideoRows.length === 0) return;

  await tenantDb.delete(fileAttachments).where(
    inArray(
      fileAttachments.id,
      staleVideoRows.map((r) => r.id),
    ),
  );
  for (const row of staleVideoRows) {
    await abortMultipartIfPending(row);
    if (row.storageKey) {
      // A single-PUT attempt could have already written bytes before being abandoned — best-effort,
      // matches `deleteObjectIfUnreferenced`'s own swallow-and-move-on posture for a key nothing else
      // references (checked via `headObject` implicitly failing/no-oping if nothing is actually there).
      await storage.deleteObject(row.storageKey).catch(() => {});
    }
  }
}

/** Removes one now-superseded attachment row entirely (old video being replaced by a new upload) —
 * same steps the generic DELETE route uses, minus `revertCourseForAttachment` (the caller already
 * reverts the course once, for the attachment change as a whole, not once per row touched). */
async function removeSupersededAttachment(tenantDb: Db, row: FileAttachmentRow): Promise<void> {
  await abortMultipartIfPending(row);
  await tenantDb.delete(fileAttachments).where(eq(fileAttachments.id, row.id));
  if (row.storageKey) {
    // Mirrors `deleteObjectIfUnreferenced` in tenant-attachment-routes.ts, inlined rather than
    // imported since it isn't exported — a replaced video's old storage key is never shared with
    // another attachment (each upload mints its own key), so no other-referrer check is needed here.
    await storage.deleteObject(row.storageKey).catch(() => {});
  }
}

interface StartUploadBody {
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
}

/**
 * Video Lesson Upload — extends the existing presigned-upload/attachment architecture
 * (`tenant-attachment-routes.ts`, `storage/storage.ts`) with a size-based single-PUT-vs-multipart
 * strategy the client never has to choose itself: `POST .../video/upload` decides, based purely on
 * `sizeBytes` (`storage/multipart-config.ts`'s `resolveVideoUploadStrategy`), and both branches
 * finish through the exact same `.../video/complete` call. A `file_attachments` row is still the one
 * durable record of the upload — multipart adds exactly one column (`multipart_upload_id`) to that
 * existing row, no parallel table.
 */
const tenantVideoUploadRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /tenant/content-items/:contentItemId/video/upload
  fastify.post<{ Params: { contentItemId: string }; Body: StartUploadBody }>(
    "/tenant/content-items/:contentItemId/video/upload",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      if (!storage.isStorageConfigured()) {
        return reply.code(503).send({ success: false, message: "Storage is not configured" });
      }

      const { contentItemId } = request.params;
      const item = await resolveVideoContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      const fileName = body.fileName?.trim();
      const contentType = body.contentType?.trim();
      if (!fileName || !contentType || body.sizeBytes === undefined || body.sizeBytes <= 0) {
        return reply.code(400).send({ success: false, message: "fileName, contentType, and a positive sizeBytes are required" });
      }
      const sizeBytes = body.sizeBytes;

      const allowlistResult = validateAgainstAllowlist("content_item_video", contentType, sizeBytes);
      if (allowlistResult.error) {
        return reply.code(422).send({ success: false, message: allowlistResult.error });
      }
      const extensionResult = validateVideoFileExtension(fileName, contentType);
      if (extensionResult.error) {
        return reply.code(422).send({ success: false, message: extensionResult.error });
      }

      await cleanupStalePendingVideo(request.tenantDb, contentItemId);

      // Server-computed, never client-supplied — a fresh random attachmentId in the key means two
      // uploads (even with an identical file name, even from the same user) can never collide, and
      // the tenant-subdomain folder prefix means no tenant can ever address another's object.
      // `fileName` is sanitized to a safe character set purely for a clean, readable key — it plays
      // no role in tenant/object isolation, which the id-based path segments above it already fully
      // provide.
      const attachmentId = randomUUID();
      const tenantFolder = await resolveTenantStorageFolder(request.tenantDb, request.user!.tenantId);
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `${tenantFolder}/content_item/${contentItemId}/${attachmentId}/${safeFileName}`;

      const strategy = resolveVideoUploadStrategy(sizeBytes);

      if (strategy === "single") {
        const uploadUrl = await storage.createPresignedUploadUrl(storageKey, contentType, sizeBytes);
        await request.tenantDb.insert(fileAttachments).values({
          id: attachmentId,
          tenantId: request.user!.tenantId,
          entityType: "content_item",
          entityId: contentItemId,
          kind: "file",
          fileName,
          contentType,
          sizeBytes,
          storageKey,
          status: "pending",
          createdByUserId: request.user!.id,
        });
        return reply.code(201).send({ success: true, data: { id: attachmentId, strategy: "single", uploadUrl } });
      }

      const partCount = computePartCount(sizeBytes);
      if (partCount > MULTIPART_MAX_PARTS) {
        return reply.code(422).send({ success: false, message: "File is too large for the current multipart configuration" });
      }
      const uploadId = await storage.createMultipartUpload(storageKey, contentType);
      await request.tenantDb.insert(fileAttachments).values({
        id: attachmentId,
        tenantId: request.user!.tenantId,
        entityType: "content_item",
        entityId: contentItemId,
        kind: "file",
        fileName,
        contentType,
        sizeBytes,
        storageKey,
        status: "pending",
        multipartUploadId: uploadId,
        createdByUserId: request.user!.id,
      });
      return reply.code(201).send({
        success: true,
        data: { id: attachmentId, strategy: "multipart", partSize: MULTIPART_PART_SIZE_BYTES, partCount },
      });
    },
  );

  // POST /tenant/attachments/:attachmentId/video/parts — presigns a small batch of part numbers at a
  // time (never the whole upload's worth up front — `multipart-config.ts`'s own reasoning).
  fastify.post<{ Params: { attachmentId: string }; Body: { partNumbers?: number[] } }>(
    "/tenant/attachments/:attachmentId/video/parts",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing || !isVideoAttachment(existing)) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (!existing.multipartUploadId || existing.status !== "pending") {
        return reply.code(422).send({ success: false, message: "This attachment has no multipart upload in progress" });
      }

      const partNumbers = request.body?.partNumbers ?? [];
      const partCount = computePartCount(existing.sizeBytes!);
      const valid =
        partNumbers.length > 0 &&
        partNumbers.length <= MULTIPART_PART_BATCH_SIZE &&
        partNumbers.every((n) => Number.isInteger(n) && n >= 1 && n <= partCount) &&
        new Set(partNumbers).size === partNumbers.length;
      if (!valid) {
        return reply.code(400).send({ success: false, message: `partNumbers must be 1-${MULTIPART_PART_BATCH_SIZE} unique integers between 1 and ${partCount}` });
      }

      const urls = await storage.createPresignedUploadPartUrls(existing.storageKey!, existing.multipartUploadId, partNumbers);
      return { success: true, data: { urls } };
    },
  );

  // POST /tenant/attachments/:attachmentId/video/complete — finalizes EITHER strategy: assembles the
  // multipart parts first if this attachment used one, then the same headObject-verified
  // pending->ready transition every attachment already goes through. Also the one place a lesson's
  // payload actually starts pointing at the uploaded video, and where a just-replaced prior video (if
  // any) is cleaned up — only once the NEW video is confirmed good, so a failed replace never leaves
  // the lesson with no video at all.
  fastify.post<{ Params: { attachmentId: string }; Body: { parts?: { partNumber: number; eTag: string }[] } }>(
    "/tenant/attachments/:attachmentId/video/complete",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing || !isVideoAttachment(existing)) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (existing.status !== "pending") {
        return reply.code(409).send({ success: false, message: "This attachment has already been finalized" });
      }

      if (existing.multipartUploadId) {
        const parts = request.body?.parts ?? [];
        if (parts.length === 0) {
          return reply.code(400).send({ success: false, message: "parts is required to complete a multipart upload" });
        }
        try {
          await storage.completeMultipartUpload(existing.storageKey!, existing.multipartUploadId, parts);
        } catch (err) {
          request.log.error(err);
          return reply.code(422).send({ success: false, message: "Failed to assemble the uploaded parts — please retry the upload" });
        }
      }

      const head = await storage.headObject(existing.storageKey!);
      if (!head.exists || head.sizeBytes !== existing.sizeBytes) {
        return reply.code(409).send({ success: false, message: "Upload not found in storage, or size mismatch" });
      }

      const [updated] = await request.tenantDb
        .update(fileAttachments)
        .set({ status: "ready", multipartUploadId: null, updatedAt: new Date() })
        .where(eq(fileAttachments.id, attachmentId))
        .returning();

      const item = await resolveContentItem(request.tenantDb, existing.entityId);
      let previousAttachmentId: string | null = null;
      if (item) {
        const [fullItem] = await request.tenantDb.select().from(contentItems).where(eq(contentItems.id, item.id));
        const payload = (fullItem?.payload ?? {}) as { videoAttachmentId?: string };
        if (typeof payload.videoAttachmentId === "string" && payload.videoAttachmentId !== attachmentId) {
          previousAttachmentId = payload.videoAttachmentId;
        }
        await request.tenantDb
          .update(contentItems)
          .set({ payload: { videoAttachmentId: attachmentId }, updatedByUserId: request.user!.id, updatedAt: new Date() })
          .where(eq(contentItems.id, item.id));
      }

      await revertCourseForAttachment(request.tenantDb, updated);

      if (previousAttachmentId) {
        const [previous] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, previousAttachmentId));
        if (previous) {
          await removeSupersededAttachment(request.tenantDb, previous);
        }
      }

      return reply.code(200).send({ success: true, data: { attachment: await toAttachmentResponseRow(request.tenantDb, updated) } });
    },
  );

  // POST /tenant/attachments/:attachmentId/video/abort — explicit user-initiated cancel. Leaves the
  // owning content item's `payload.uploadPending` untouched (still "no confirmed video yet") so the
  // user can immediately try a different file without any extra state to reset.
  fastify.post<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId/video/abort",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing || !isVideoAttachment(existing)) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }
      if (existing.status !== "pending") {
        return reply.code(409).send({ success: false, message: "Only a pending upload can be cancelled" });
      }

      await removeSupersededAttachment(request.tenantDb, existing);
      return reply.code(200).send({ success: true });
    },
  );
};

export default tenantVideoUploadRoutes;
