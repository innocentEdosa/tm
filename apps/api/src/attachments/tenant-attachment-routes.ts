import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission, requireAnyPermission } from "../permissions/require-permission";
import { contentItems } from "../db/schema/course-content";
import { fileAttachments } from "../db/schema/file-attachments";
import { users } from "../db/schema/users";
import { validateAgainstAllowlist } from "./attachment-allowlist";
import * as storage from "../storage/storage";
import type { Db } from "../db/client";

type FileAttachmentRow = typeof fileAttachments.$inferSelect;

interface CreateAttachmentBody {
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
}

/**
 * data-model.md / research.md §9. Deletes every attachment belonging to a given entity — both the R2
 * objects and the rows — in one call. Not wired to any HTTP route or any existing entity's delete
 * handler in this spec (spec FR-009/Assumptions); intended for a future caller (e.g. a modified
 * content-item delete handler) to invoke directly. Trusts its caller to have already checked
 * permission — this function has no `request`/user context of its own to check against.
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
    await storage.deleteObject(row.storageKey);
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
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      createdBy,
      createdAt: row.createdAt,
    };
  }

  async function resolveContentItem(tenantDb: typeof fastify.db, contentItemId: string) {
    const [item] = await tenantDb.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentItemId));
    return item ?? null;
  }

  // POST /tenant/content-items/:contentItemId/attachments — spec FR-001/FR-002/FR-005/FR-012, contracts §POST.
  fastify.post<{ Params: { contentItemId: string }; Body: CreateAttachmentBody }>(
    "/tenant/content-items/:contentItemId/attachments",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      if (!storage.isStorageConfigured()) {
        return reply.code(503).send({ success: false, message: "Storage is not configured" });
      }

      const { contentItemId } = request.params;
      const body = request.body ?? {};
      if (!body.fileName?.trim() || !body.contentType?.trim() || body.sizeBytes === undefined || body.sizeBytes <= 0) {
        return reply.code(400).send({ success: false, message: "fileName, contentType, and a positive sizeBytes are required" });
      }

      const item = await resolveContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const validation = validateAgainstAllowlist("content_item", body.contentType, body.sizeBytes);
      if (validation.error) {
        return reply.code(422).send({ success: false, message: validation.error });
      }

      const attachmentId = randomUUID();
      const storageKey = `${request.user!.tenantId}/content_item/${contentItemId}/${attachmentId}/${body.fileName.trim()}`;

      const [created] = await request.tenantDb
        .insert(fileAttachments)
        .values({
          id: attachmentId,
          tenantId: request.user!.tenantId,
          entityType: "content_item",
          entityId: contentItemId,
          fileName: body.fileName.trim(),
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey,
          status: "pending",
          createdByUserId: request.user!.id,
        })
        .returning();

      const uploadUrl = await storage.createPresignedUploadUrl(created.storageKey, created.contentType, created.sizeBytes);
      return reply.code(201).send({ success: true, data: { id: created.id, uploadUrl } });
    },
  );

  // POST /tenant/attachments/:attachmentId/confirm — spec FR-004, contracts §POST confirm.
  fastify.post<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId/confirm",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
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

  // GET /tenant/attachments/:attachmentId/download-url — spec FR-007, contracts §GET download-url.
  fastify.get<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId/download-url",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("course.view", "course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing || existing.status !== "ready") {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const downloadUrl = await storage.createPresignedDownloadUrl(existing.storageKey);
      return { success: true, data: { downloadUrl } };
    },
  );

  // DELETE /tenant/attachments/:attachmentId — spec FR-008, contracts §DELETE.
  fastify.delete<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      await storage.deleteObject(existing.storageKey);
      await request.tenantDb.delete(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      return reply.code(200).send({ success: true });
    },
  );
};

export default tenantAttachmentRoutes;
