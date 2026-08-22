import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";
import { formDefinitions, formFields } from "../db/schema/custom-fields";
import { formVersions, formSections } from "../db/schema/form-builder";
import {
  expandVersion,
  replaceDraftStructure,
  cloneVersionInto,
  reconcileTenantFieldsOnPublish,
  DraftValidationError,
  type StepInput,
  type SectionInput,
  type FieldInput,
  type FormLayoutConfig,
} from "./version-helpers";
import { listFormTypes } from "./list-form-types";

interface CreateFormTypeBody {
  name?: string;
  key?: string;
  description?: string;
  icon?: string;
}

interface PatchFormTypeBody {
  name?: string;
  description?: string;
  icon?: string;
  status?: "active" | "archived";
  allowMultipleResponses?: boolean;
}

interface PatchVersionBody {
  steps?: StepInput[];
  sections?: SectionInput[];
  fields?: FieldInput[];
  layoutConfig?: FormLayoutConfig | null;
}

/** contracts/form-builder-api.md "Platform routes". Every route here gates purely on
 * `requireSuperAdminSession` — no `permissions` table row, matching how every other
 * Super-Admin-only surface in this codebase works (research.md §7). Writes go through
 * `request.superAdminDb`, which the `super_admin_full_access` RLS policies (migration 0108)
 * are the only thing that ever permits. */
const platformFormRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: CreateFormTypeBody }>(
    "/platform/forms",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { name, key, description, icon } = request.body ?? {};
      if (!name?.trim() || !key?.trim() || !description?.trim()) {
        return reply.code(400).send({ success: false, message: "name, key, and description are required" });
      }
      const db = request.superAdminDb!;

      const [existing] = await db.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, key));
      if (existing) {
        return reply.code(409).send({ success: false, message: "A form type with this key already exists" });
      }

      const [created] = await db
        .insert(formDefinitions)
        .values({
          key,
          name: name.trim(),
          description: description.trim(),
          icon: icon ?? null,
          status: "active",
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      return reply.code(201).send({ success: true, data: created });
    },
  );

  fastify.get<{ Querystring: { page?: string; pageSize?: string; search?: string; builtInFirst?: string } }>(
    "/platform/forms",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
      const pageSize = request.query.pageSize ? parseInt(request.query.pageSize, 10) : undefined;
      const result = await listFormTypes(request.superAdminDb!, {
        page,
        pageSize,
        search: request.query.search,
        builtInFirst: request.query.builtInFirst === "true",
      });
      return { success: true, data: result };
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/platform/forms/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const db = request.superAdminDb!;
      const [definition] = await db.select().from(formDefinitions).where(eq(formDefinitions.id, request.params.id));
      if (!definition) return reply.code(404).send({ success: false, message: "Not found" });

      const versions = (
        await db
          .select({ id: formVersions.id, versionNumber: formVersions.versionNumber, status: formVersions.status, publishedAt: formVersions.publishedAt })
          .from(formVersions)
          .where(eq(formVersions.formDefinitionId, definition.id))
      ).sort((a, b) => b.versionNumber - a.versionNumber);

      return { success: true, data: { ...definition, versions } };
    },
  );

  fastify.patch<{ Params: { id: string }; Body: PatchFormTypeBody }>(
    "/platform/forms/:id",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const db = request.superAdminDb!;
      const body = request.body ?? {};
      const [updated] = await db
        .update(formDefinitions)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.icon !== undefined ? { icon: body.icon } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.allowMultipleResponses !== undefined ? { allowMultipleResponses: body.allowMultipleResponses } : {}),
          updatedAt: new Date(),
        })
        .where(eq(formDefinitions.id, request.params.id))
        .returning();
      if (!updated) return reply.code(404).send({ success: false, message: "Not found" });
      return { success: true, data: updated };
    },
  );

  fastify.post<{ Params: { id: string }; Body: { cloneFrom?: "active" | string } }>(
    "/platform/forms/:id/versions",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const db = request.superAdminDb!;
      const formDefinitionId = request.params.id;

      const [definition] = await db.select().from(formDefinitions).where(eq(formDefinitions.id, formDefinitionId));
      if (!definition) return reply.code(404).send({ success: false, message: "Not found" });

      const [existingDraft] = await db
        .select({ id: formVersions.id })
        .from(formVersions)
        .where(and(eq(formVersions.formDefinitionId, formDefinitionId), eq(formVersions.status, "draft")));
      if (existingDraft) {
        return reply.code(409).send({ success: false, message: "A draft version already exists for this form type" });
      }

      const existingVersions = await db
        .select({ versionNumber: formVersions.versionNumber })
        .from(formVersions)
        .where(eq(formVersions.formDefinitionId, formDefinitionId));
      const nextVersionNumber = existingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

      const [draft] = await db
        .insert(formVersions)
        .values({
          formDefinitionId,
          versionNumber: nextVersionNumber,
          status: "draft",
          createdBySuperAdminId: request.superAdmin!.id,
        })
        .returning();

      const cloneFrom = request.body?.cloneFrom;
      const sourceVersionId = cloneFrom === "active" ? definition.activeVersionId : (cloneFrom ?? null);
      if (sourceVersionId) {
        await cloneVersionInto(db, sourceVersionId, draft.id);
      }

      return reply.code(201).send({ success: true, data: { id: draft.id, versionNumber: draft.versionNumber, status: draft.status } });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/platform/forms/:id/versions",
    { preHandler: [requireSuperAdminSession] },
    async (request) => {
      const rows = (
        await request
          .superAdminDb!.select({ id: formVersions.id, versionNumber: formVersions.versionNumber, status: formVersions.status, publishedAt: formVersions.publishedAt })
          .from(formVersions)
          .where(eq(formVersions.formDefinitionId, request.params.id))
      ).sort((a, b) => b.versionNumber - a.versionNumber);
      return { success: true, data: rows };
    },
  );

  fastify.get<{ Params: { id: string; versionId: string } }>(
    "/platform/forms/:id/versions/:versionId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const expanded = await expandVersion(request.superAdminDb!, request.params.versionId);
      if (!expanded) return reply.code(404).send({ success: false, message: "Not found" });
      return { success: true, data: expanded };
    },
  );

  fastify.patch<{ Params: { id: string; versionId: string }; Body: PatchVersionBody }>(
    "/platform/forms/:id/versions/:versionId",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const db = request.superAdminDb!;
      const { versionId } = request.params;

      const [version] = await db.select().from(formVersions).where(eq(formVersions.id, versionId));
      if (!version) return reply.code(404).send({ success: false, message: "Not found" });
      if (version.status !== "draft") {
        return reply.code(409).send({ success: false, message: "Only a draft version can be edited — create a new draft first" });
      }

      try {
        await replaceDraftStructure(db, versionId, request.body ?? {});
      } catch (err) {
        if (err instanceof DraftValidationError) {
          return reply.code(422).send({ success: false, message: err.message });
        }
        throw err;
      }

      const expanded = await expandVersion(db, versionId);
      return { success: true, data: expanded };
    },
  );

  // PATCH .../system-fields/:fieldKey — the one thing a Super Admin CAN change on a system field
  // (spec follow-up: "even if they can't change labels"). Deliberately a separate, narrow route
  // rather than routed through `replaceDraftStructure` (whose whole job is refusing to let
  // `input.fields` touch system rows at all, per the security fix earlier in this feature — no
  // reason to reopen that surface just for this). Only ever touches `description`/`placeholder`
  // on a row that's already `isSystem = true` on this exact draft version; label, fieldType,
  // fieldKey, isRequired, layout, and section placement all stay under `replaceDraftStructure`'s
  // exclusive, snapshot-based control.
  fastify.patch<{ Params: { id: string; versionId: string; fieldKey: string }; Body: { description?: string | null; placeholder?: string | null } }>(
    "/platform/forms/:id/versions/:versionId/system-fields/:fieldKey",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const db = request.superAdminDb!;
      const { versionId, fieldKey } = request.params;

      const [version] = await db.select().from(formVersions).where(eq(formVersions.id, versionId));
      if (!version) return reply.code(404).send({ success: false, message: "Not found" });
      if (version.status !== "draft") {
        return reply.code(409).send({ success: false, message: "Only a draft version can be edited — create a new draft first" });
      }

      const body = request.body ?? {};
      const [updated] = await db
        .update(formFields)
        .set({
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.placeholder !== undefined ? { placeholder: body.placeholder } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(formFields.formVersionId, versionId), eq(formFields.fieldKey, fieldKey), eq(formFields.isSystem, true)))
        .returning();
      if (!updated) return reply.code(404).send({ success: false, message: "System field not found on this version" });

      return { success: true, data: updated };
    },
  );

  fastify.post<{ Params: { id: string; versionId: string } }>(
    "/platform/forms/:id/versions/:versionId/publish",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const db = request.superAdminDb!;
      const { id: formDefinitionId, versionId } = request.params;

      const [version] = await db.select().from(formVersions).where(eq(formVersions.id, versionId));
      if (!version) return reply.code(404).send({ success: false, message: "Not found" });
      if (version.status !== "draft") {
        return reply.code(409).send({ success: false, message: "Only a draft version can be published" });
      }

      const sections = await db.select().from(formSections).where(eq(formSections.formVersionId, versionId));
      const fieldCount = await db.select({ id: formFields.id }).from(formFields).where(eq(formFields.formVersionId, versionId));
      if (sections.length === 0 || fieldCount.length === 0) {
        return reply.code(422).send({ success: false, message: "A form must have at least one section with at least one field before it can be published" });
      }

      const [definition] = await db.select().from(formDefinitions).where(eq(formDefinitions.id, formDefinitionId));
      const previousVersionId = definition?.activeVersionId ?? null;

      const now = new Date();
      await db.update(formVersions).set({ status: "published", publishedAt: now, updatedAt: now }).where(eq(formVersions.id, versionId));
      if (previousVersionId && previousVersionId !== versionId) {
        await db.update(formVersions).set({ status: "archived", archivedAt: now, updatedAt: now }).where(eq(formVersions.id, previousVersionId));
      }
      await db.update(formDefinitions).set({ activeVersionId: versionId, updatedAt: now }).where(eq(formDefinitions.id, formDefinitionId));

      await reconcileTenantFieldsOnPublish(db, formDefinitionId, previousVersionId, versionId);

      return { success: true, data: { id: versionId, versionNumber: version.versionNumber, status: "published", publishedAt: now } };
    },
  );

  fastify.post<{ Params: { id: string; versionId: string } }>(
    "/platform/forms/:id/versions/:versionId/archive",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const db = request.superAdminDb!;
      const { id: formDefinitionId, versionId } = request.params;

      const [definition] = await db.select().from(formDefinitions).where(eq(formDefinitions.id, formDefinitionId));
      if (definition?.activeVersionId === versionId) {
        return reply.code(409).send({ success: false, message: "Cannot archive the currently active version — publish a replacement first" });
      }

      const [updated] = await db
        .update(formVersions)
        .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(formVersions.id, versionId))
        .returning();
      if (!updated) return reply.code(404).send({ success: false, message: "Not found" });
      return { success: true, data: updated };
    },
  );
};

export default platformFormRoutes;
