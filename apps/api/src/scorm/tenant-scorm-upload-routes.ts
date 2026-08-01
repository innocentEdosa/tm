import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { contentItems } from "../db/schema/course-content";
import { scormPackageItems } from "../db/schema/scorm";
import { learnerContentProgress } from "../db/schema/learner-content-progress";
import * as storage from "../storage/storage";
import { resolveTenantStorageFolder } from "../storage/tenant-storage-path";
import { importPackage } from "./package-importer";
import type { Db } from "../db/client";

const MAX_PACKAGE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB (research.md §11)

interface UploadUrlBody {
  sizeBytes?: number;
}

interface ImportBody {
  storageKey?: string;
}

async function resolveScormContentItem(tenantDb: Db, contentItemId: string) {
  const [item] = await tenantDb.select().from(contentItems).where(eq(contentItems.id, contentItemId));
  if (!item) return null;
  const payload = item.payload as { sourceType?: string } | null;
  if (item.type !== "external_import" || payload?.sourceType !== "scorm") return null;
  return item;
}

/** contracts/scorm-runtime-api.md. Admin upload/import — `course.manage`, reusing spec 024's existing
 * permission (no new permission key). Purpose-built pipeline, deliberately not spec 025's
 * `file_attachments` route surface (research.md §4). */
const tenantScormUploadRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /tenant/content-items/:contentItemId/scorm/upload-url — spec FR-001, contracts §POST upload-url.
  fastify.post<{ Params: { contentItemId: string }; Body: UploadUrlBody }>(
    "/tenant/content-items/:contentItemId/scorm/upload-url",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const item = await resolveScormContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (!body.sizeBytes || body.sizeBytes <= 0 || body.sizeBytes > MAX_PACKAGE_SIZE_BYTES) {
        return reply.code(422).send({ success: false, message: `sizeBytes must be a positive number no greater than ${MAX_PACKAGE_SIZE_BYTES}` });
      }

      const [existingSco] = await request.tenantDb.select({ id: scormPackageItems.id }).from(scormPackageItems).where(eq(scormPackageItems.contentItemId, contentItemId));
      if (existingSco) {
        return reply.code(409).send({ success: false, message: "A package has already been imported for this content item" });
      }

      const uploadId = randomUUID();
      const tenantFolder = await resolveTenantStorageFolder(request.tenantDb, request.user!.tenantId);
      const storageKey = `${tenantFolder}/scorm-raw/${contentItemId}/${uploadId}.zip`;
      const uploadUrl = await storage.createPresignedUploadUrl(storageKey, "application/zip", body.sizeBytes);
      return reply.code(201).send({ success: true, data: { uploadUrl, storageKey } });
    },
  );

  // POST /tenant/content-items/:contentItemId/scorm/import — spec FR-002/FR-003/FR-004, contracts §POST import.
  fastify.post<{ Params: { contentItemId: string }; Body: ImportBody }>(
    "/tenant/content-items/:contentItemId/scorm/import",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const item = await resolveScormContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (!body.storageKey) {
        return reply.code(400).send({ success: false, message: "storageKey is required" });
      }

      const head = await storage.headObject(body.storageKey);
      if (!head.exists) {
        return reply.code(409).send({ success: false, message: "Uploaded package not found in storage" });
      }

      const existingScos = await request.tenantDb.select({ contentItemId: scormPackageItems.contentItemId }).from(scormPackageItems).where(eq(scormPackageItems.contentItemId, contentItemId));
      for (const sco of existingScos) {
        const [launched] = await request.tenantDb.select({ id: learnerContentProgress.id }).from(learnerContentProgress).where(eq(learnerContentProgress.contentItemId, sco.contentItemId));
        if (launched) {
          return reply.code(409).send({ success: false, message: "This content item's package has already been launched by a learner — re-versioning is not supported" });
        }
      }

      const objectStream = await storage.getObjectStream(body.storageKey);
      if (!objectStream) {
        return reply.code(409).send({ success: false, message: "Uploaded package not found in storage" });
      }
      const chunks: Buffer[] = [];
      for await (const chunk of objectStream.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const zipBuffer = Buffer.concat(chunks);

      const result = await importPackage(request.tenantDb, request.user!.tenantId, contentItemId, request.user!.id, zipBuffer);
      if ("error" in result) {
        return reply.code(422).send({ success: false, message: result.error });
      }

      await storage.deleteObject(body.storageKey);
      return reply.code(201).send({ success: true, data: result });
    },
  );
};

export default tenantScormUploadRoutes;
