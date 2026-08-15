import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requirePermission } from "../permissions/require-permission";
import { contentItems } from "../db/schema/course-content";
import { courses } from "../db/schema/courses";
import { courseAuthors } from "../db/schema/course-authors";
import { fileAttachments } from "../db/schema/file-attachments";
import { platformFileAttachments } from "../db/schema/platform-courses";
import { users } from "../db/schema/users";
import { validateAgainstAllowlist } from "./attachment-allowlist";
import { revertToDraftIfPublished } from "../courses/revert-course-to-draft";
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
 * File reuse (Course Creation File Manager) means a `storage_key` can now legitimately be referenced
 * by more than one `file_attachments` row — and, via `clone-platform-course.ts`, a tenant row can
 * already share its `storage_key` with a `platform_file_attachments` row the platform (and every
 * other tenant that cloned the same course) still owns. Deleting an R2 object out from under a
 * reference that's still live would silently break whatever else points at it, so every deletion path
 * must check for *other* referrers first — this is that check, shared by both the bulk
 * (`deleteAllAttachmentsForEntity`) and single-attachment (`DELETE /tenant/attachments/:id`) delete
 * paths below.
 *
 * `request.tenantDb` already runs the whole request inside one transaction (`tenant-context.ts`), so
 * "delete the row(s), then check what's left" is naturally atomic *within this request*. Across
 * concurrent requests deleting different rows that share the same key, though, two transactions could
 * each see the other's row as still present (not yet committed) and both conclude "still referenced" —
 * safe (just a harmless leaked object), but the opposite race — both concluding "I'm the last
 * reference" while the other is still mid-flight — is the one that must never happen. A
 * `pg_advisory_xact_lock` keyed on the storage key serializes exactly that: the second deleter blocks
 * until the first's transaction fully commits (or rolls back), so its own count query always sees a
 * fully-settled view. No new infrastructure — this is a built-in Postgres primitive, auto-released at
 * end of transaction.
 *
 * Only counts `file_attachments` rows *this tenant can see* (RLS-scoped, matching every other query in
 * this file) plus any `platform_file_attachments` row (unrestricted, no RLS) — it can't see another
 * tenant's own `file_attachments` rows referencing the same platform-sourced key. In practice that gap
 * only matters if the platform's own attachment row was itself deleted while ≥2 tenants still
 * reference the object; documented as a known residual gap rather than solved here (would need a
 * cross-tenant, RLS-bypassing query — out of scope for this pass).
 */
async function deleteObjectIfUnreferenced(tenantDb: Db, storageKey: string): Promise<void> {
  await tenantDb.execute(sql`select pg_advisory_xact_lock(hashtext(${storageKey}))`);

  const [tenantRef] = await tenantDb
    .select({ id: fileAttachments.id })
    .from(fileAttachments)
    .where(eq(fileAttachments.storageKey, storageKey))
    .limit(1);
  if (tenantRef) return;

  const [platformRef] = await tenantDb
    .select({ id: platformFileAttachments.id })
    .from(platformFileAttachments)
    .where(eq(platformFileAttachments.storageKey, storageKey))
    .limit(1);
  if (platformRef) return;

  await storage.deleteObject(storageKey);
}

type ReuseResolution =
  | { ok: true; source: FileAttachmentRow }
  | { ok: false; status: number; message: string };

/**
 * Shared validation for every "reuse an existing tenant file" endpoint (Course Creation File Manager,
 * course-image picker) — resolves `sourceAttachmentId` via `tenantDb` (RLS-scoped, so a cross-tenant
 * id already matches no row) with an explicit `tenantId` check as defense-in-depth, then confirms it's
 * a `kind:"file"`, `status:"ready"` row. A caller needing a stricter allowlist than what the source was
 * originally validated against (e.g. reusing into a course image, `attachment-allowlist.ts`'s tightest
 * entry) runs `validateAgainstAllowlist` itself afterward — every allowlist in this codebase is either
 * equal to or a strict subset of `content_item`'s (the most permissive: same image types plus PDF, a
 * larger size cap), so nothing already valid for `course`/`course_author` can ever fail reuse *into* a
 * content item.
 */
async function resolveReusableSourceFile(
  tenantDb: Db,
  tenantId: string,
  sourceAttachmentId: string,
): Promise<ReuseResolution> {
  const [source] = await tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, sourceAttachmentId));
  if (!source || source.tenantId !== tenantId) {
    return { ok: false, status: 404, message: "Not found" };
  }
  if (source.kind !== "file" || !source.storageKey) {
    return { ok: false, status: 422, message: "Only uploaded files can be reused" };
  }
  if (source.status !== "ready") {
    return { ok: false, status: 422, message: "Only a ready attachment can be reused" };
  }
  return { ok: true, source };
}

/**
 * data-model.md / research.md §9. Deletes every attachment belonging to a given entity — the rows
 * always, their underlying R2 objects only once no other attachment (tenant or platform) still
 * references the same `storage_key` (see `deleteObjectIfUnreferenced` above). Wired into
 * content-item, course-author, and course delete (which also cascades through its content items).
 * Trusts its caller to have already checked permission — this function has no `request`/user context
 * of its own to check against. A `link`-kind row has no `storageKey` (nothing was ever uploaded to R2
 * for it) — only `file`-kind rows need a `deleteObject` call.
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

  if (rows.length === 0) return;

  await tenantDb.delete(fileAttachments).where(inArray(fileAttachments.id, rows.map((r) => r.id)));

  const uniqueStorageKeys = [...new Set(rows.map((r) => r.storageKey).filter((key): key is string => !!key))];
  for (const key of uniqueStorageKeys) {
    await deleteObjectIfUnreferenced(tenantDb, key);
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
    const [item] = await tenantDb.select({ id: contentItems.id, courseId: contentItems.courseId }).from(contentItems).where(eq(contentItems.id, contentItemId));
    return item ?? null;
  }

  /** Course Content Draft-Reversion, applied to the polymorphic `file_attachments` table — resolves
   * which course (if any) an attachment row belongs to and reverts it, covering both a course's own
   * image (`entityType: "course"`, `entityId` IS the courseId) and a lesson resource/image
   * (`entityType: "content_item"`, one lookup to its parent course). Every other `entityType`
   * (`course_author`, and the platform-side ones this route never touches) isn't course content, so
   * it's a no-op — the caller doesn't need to branch on `entityType` itself. */
  async function revertCourseForAttachment(tenantDb: typeof fastify.db, attachment: FileAttachmentRow): Promise<void> {
    if (attachment.entityType === "course") {
      await revertToDraftIfPublished(tenantDb, attachment.entityId);
    } else if (attachment.entityType === "content_item") {
      const item = await resolveContentItem(tenantDb, attachment.entityId);
      if (item) await revertToDraftIfPublished(tenantDb, item.courseId);
    }
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
        await revertToDraftIfPublished(request.tenantDb, item.courseId);
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

      await revertCourseForAttachment(request.tenantDb, updated);
      return reply.code(200).send({ success: true, data: await toResponseRow(request.tenantDb, updated) });
    },
  );

  // GET /tenant/content-items/:contentItemId/attachments — spec FR-006, contracts §GET list.
  fastify.get<{ Params: { contentItemId: string } }>(
    "/tenant/content-items/:contentItemId/attachments",
    // "My Learning" is open to any authenticated tenant user; these two routes aren't retrofitted
    // with a per-course visibility check (unlike curriculum/authors/reviews above) — same known,
    // pre-existing gap as before this change (a `course.view` holder could already fetch any
    // attachment's metadata/download URL by id, not just ones on courses assigned to them), just now
    // reachable by more roles. Left as a bounded, explicitly-noted trade-off rather than retrofitting
    // full resource-level ACL onto the polymorphic attachments system in this pass.
    { preHandler: [requireTenantUserSession()] },
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
    // "My Learning" is open to any authenticated tenant user; these two routes aren't retrofitted
    // with a per-course visibility check (unlike curriculum/authors/reviews above) — same known,
    // pre-existing gap as before this change (a `course.view` holder could already fetch any
    // attachment's metadata/download URL by id, not just ones on courses assigned to them), just now
    // reachable by more roles. Left as a bounded, explicitly-noted trade-off rather than retrofitting
    // full resource-level ACL onto the polymorphic attachments system in this pass.
    { preHandler: [requireTenantUserSession()] },
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
  // no R2 object to delete — just the row. Row is deleted first, then the object is only deleted if no
  // other attachment (tenant or platform) still references the same `storage_key` — see
  // `deleteObjectIfUnreferenced`.
  fastify.delete<{ Params: { attachmentId: string } }>(
    "/tenant/attachments/:attachmentId",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const [existing] = await request.tenantDb.select().from(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      await request.tenantDb.delete(fileAttachments).where(eq(fileAttachments.id, attachmentId));
      if (existing.storageKey) {
        await deleteObjectIfUnreferenced(request.tenantDb, existing.storageKey);
      }
      await revertCourseForAttachment(request.tenantDb, existing);
      return reply.code(200).send({ success: true });
    },
  );

  // GET /tenant/files — Course Creation File Manager + course-image picker. Lists every ready,
  // `kind:"file"` attachment belonging to the tenant (RLS-scoped — same convention as every other
  // route in this file, no explicit tenant filter needed), deduped by `storage_key` so a file already
  // reused across multiple entities (via the reuse routes above) appears once, not once per reference.
  // `link`-kind rows are excluded — reusing a link is just re-entering its URL via the normal create
  // route; there's no upload to dedupe. The response `id` (the oldest attachment row for that storage
  // key) is what the reuse routes above expect as `sourceAttachmentId`. Every image row also carries a
  // presigned `thumbnailUrl` (the course-image picker's gallery grid) — cheap to compute even for
  // callers that don't render it (`createPresignedDownloadUrl` is local HMAC signing, no R2 round
  // trip), so it's unconditional rather than opt-in via a query param.
  fastify.get(
    "/tenant/files",
    // Scoped to course.manage (not just requireTenantUserSession(), unlike the per-entity list route
    // above) — this is a tenant-wide listing, a broader disclosure than one entity's attachments, so
    // it's kept to the same role that can already create/delete attachments.
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request) => {
      const rows = await request.tenantDb
        .select()
        .from(fileAttachments)
        .where(and(eq(fileAttachments.kind, "file"), eq(fileAttachments.status, "ready")))
        .orderBy(fileAttachments.createdAt);

      const byStorageKey = new Map<string, FileAttachmentRow>();
      for (const row of rows) {
        if (row.storageKey && !byStorageKey.has(row.storageKey)) {
          byStorageKey.set(row.storageKey, row);
        }
      }
      const deduped = [...byStorageKey.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const storageConfigured = storage.isStorageConfigured();
      const data = await Promise.all(
        deduped.map(async (r) => {
          const base = await toResponseRow(request.tenantDb, r);
          const isImage = r.contentType?.startsWith("image/") ?? false;
          const thumbnailUrl = isImage && r.storageKey && storageConfigured ? await storage.createPresignedDownloadUrl(r.storageKey) : null;
          return { ...base, thumbnailUrl };
        }),
      );
      return { success: true, data };
    },
  );

  // POST /tenant/content-items/:contentItemId/attachments/reuse — Course Creation File Manager.
  // Attaches an *existing* tenant file to another content item without a presigned-upload round trip
  // or any new R2 object: copies `storageKey`/`fileName`/`contentType`/`sizeBytes` from the source row
  // into a brand-new `file_attachments` row, `status:'ready'` immediately. Mirrors exactly what
  // `clone-platform-course.ts` already does when cloning a platform attachment into a tenant.
  fastify.post<{ Params: { contentItemId: string }; Body: { sourceAttachmentId?: string } }>(
    "/tenant/content-items/:contentItemId/attachments/reuse",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { contentItemId } = request.params;
      const sourceAttachmentId = request.body?.sourceAttachmentId?.trim();
      if (!sourceAttachmentId) {
        return reply.code(400).send({ success: false, message: "sourceAttachmentId is required" });
      }

      const item = await resolveContentItem(request.tenantDb, contentItemId);
      if (!item) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const resolution = await resolveReusableSourceFile(request.tenantDb, request.user!.tenantId, sourceAttachmentId);
      if (!resolution.ok) {
        return reply.code(resolution.status).send({ success: false, message: resolution.message });
      }
      const { source } = resolution;

      const [created] = await request.tenantDb
        .insert(fileAttachments)
        .values({
          tenantId: request.user!.tenantId,
          entityType: "content_item",
          entityId: contentItemId,
          kind: "file",
          fileName: source.fileName,
          contentType: source.contentType,
          sizeBytes: source.sizeBytes,
          storageKey: source.storageKey,
          status: "ready",
          createdByUserId: request.user!.id,
        })
        .returning();
      await revertToDraftIfPublished(request.tenantDb, item.courseId);

      return reply.code(201).send({ success: true, data: await toResponseRow(request.tenantDb, created) });
    },
  );

  // POST /tenant/courses/:courseId/image/reuse — Course Details' course-image picker. Attaches an
  // existing tenant image as this course's image, mirroring `POST /tenant/courses/:courseId/image`'s
  // "delete any prior image first, a course only ever has one current image" behavior, but skipping
  // the presigned-upload round trip and R2 object entirely — same shared-storage-key pattern as the
  // content-item reuse route above. Re-validates against the `course` allowlist (image-only, 5 MB
  // cap) even though the source was already validated once at its original upload — it may have been
  // uploaded under a more permissive allowlist (e.g. `content_item`'s 25 MB/PDF-inclusive one).
  fastify.post<{ Params: { courseId: string }; Body: { sourceAttachmentId?: string } }>(
    "/tenant/courses/:courseId/image/reuse",
    { preHandler: [requireTenantUserSession(), requirePermission("course.manage")] },
    async (request, reply) => {
      const { courseId } = request.params;
      const sourceAttachmentId = request.body?.sourceAttachmentId?.trim();
      if (!sourceAttachmentId) {
        return reply.code(400).send({ success: false, message: "sourceAttachmentId is required" });
      }

      const [course] = await request.tenantDb.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
      if (!course) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const resolution = await resolveReusableSourceFile(request.tenantDb, request.user!.tenantId, sourceAttachmentId);
      if (!resolution.ok) {
        return reply.code(resolution.status).send({ success: false, message: resolution.message });
      }
      const { source } = resolution;

      const validation = validateAgainstAllowlist("course", source.contentType!, source.sizeBytes!);
      if (validation.error) {
        return reply.code(422).send({ success: false, message: validation.error });
      }

      await deleteAllAttachmentsForEntity(request.tenantDb, "course", courseId);

      const [created] = await request.tenantDb
        .insert(fileAttachments)
        .values({
          tenantId: request.user!.tenantId,
          entityType: "course",
          entityId: courseId,
          kind: "file",
          fileName: source.fileName,
          contentType: source.contentType,
          sizeBytes: source.sizeBytes,
          storageKey: source.storageKey,
          status: "ready",
          createdByUserId: request.user!.id,
        })
        .returning();
      await revertToDraftIfPublished(request.tenantDb, courseId);

      return reply.code(201).send({ success: true, data: await toResponseRow(request.tenantDb, created) });
    },
  );
};

export default tenantAttachmentRoutes;
