import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { formDefinitions, formFields, customFieldValues, formFieldOrderOverrides } from "../db/schema/custom-fields";
import { getFormFields, fieldKeyCollisionExists } from "./field-key-uniqueness";
import { slugify } from "./field-validation";
import { saveCustomFieldValues } from "./save-values";

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect"] as const;
type FieldType = (typeof FIELD_TYPES)[number];

interface CreateFieldBody {
  formKey?: string;
  label?: string;
  fieldKey?: string;
  fieldType?: FieldType;
  options?: string[];
  isRequired?: boolean;
}

interface PatchFieldBody {
  label?: string;
  fieldType?: FieldType;
  options?: string[];
  isRequired?: boolean;
  archived?: boolean;
}

/** contracts/custom-fields-api.md. All routes operate through `request.tenantDb` (RLS-scoped) —
 * `form_fields`'s dual-visibility policy (research.md §1) means a global row is simply unreachable
 * for write here, not explicitly checked for by this code. */
const tenantFormRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tenant/form-definitions — gated forms.manage.tenant OR the granular forms.tenant.read
  // (Granular Permissions addendum) — the Settings > Forms list itself.
  fastify.get(
    "/tenant/form-definitions",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("forms.manage.tenant", "forms.tenant.read"),
      ],
    },
    async (request) => {
      const rows = await request.tenantDb
        .select({ id: formDefinitions.id, key: formDefinitions.key, name: formDefinitions.name, description: formDefinitions.description })
        .from(formDefinitions);
      return { success: true, data: rows };
    },
  );

  // GET /tenant/form-fields?formKey= — deliberately open to any authenticated tenant session, not
  // gated by forms.manage.tenant (research.md §4) — a form's own permission (e.g. department.manage)
  // is what actually gates reaching a screen that needs this data (spec FR-010).
  fastify.get<{ Querystring: { formKey?: string } }>(
    "/tenant/form-fields",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { formKey } = request.query;
      if (!formKey) {
        return reply.code(400).send({ success: false, message: "formKey is required" });
      }
      const data = await getFormFields(request.tenantDb, formKey);
      return { success: true, data };
    },
  );

  // POST /tenant/form-fields — spec FR-003/FR-005, gated forms.manage.tenant or forms.tenant.create.
  fastify.post<{ Body: CreateFieldBody }>(
    "/tenant/form-fields",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("forms.manage.tenant", "forms.tenant.create"),
      ],
    },
    async (request, reply) => {
      const { formKey, label, fieldType, options, isRequired } = request.body ?? {};
      if (!formKey || !label || !label.trim() || !fieldType) {
        return reply.code(400).send({ success: false, message: "formKey, label, and fieldType are required" });
      }
      if (!FIELD_TYPES.includes(fieldType)) {
        return reply.code(400).send({ success: false, message: "Unrecognized fieldType" });
      }
      if ((fieldType === "select" || fieldType === "multiselect") && (!options || options.length === 0)) {
        return reply.code(400).send({ success: false, message: "options is required for select/multiselect fields" });
      }

      const [definition] = await request.tenantDb
        .select({ id: formDefinitions.id })
        .from(formDefinitions)
        .where(eq(formDefinitions.key, formKey));
      if (!definition) {
        return reply.code(404).send({ success: false, message: "Unknown form type" });
      }

      const fieldKey = request.body.fieldKey?.trim() || slugify(label);
      if (await fieldKeyCollisionExists(request.tenantDb, definition.id, fieldKey)) {
        return reply.code(409).send({ success: false, message: "A field with this key already exists on this form" });
      }

      const tenantId = request.user!.tenantId;
      // Appends after the highest *effective* order across the whole form (system + global +
      // tenant, overrides included) — not just this tenant's own rows — so a newly added field
      // lands at the end of whatever order is currently in effect, rather than potentially
      // interleaving with system/global fields by coincidence of raw displayOrder values.
      const existingFields = await getFormFields(request.tenantDb, formKey);
      const nextDisplayOrder = existingFields.reduce((max, f) => Math.max(max, f.displayOrder), -1) + 1;

      const [created] = await request.tenantDb
        .insert(formFields)
        .values({
          formDefinitionId: definition.id,
          tenantId,
          fieldKey,
          label: label.trim(),
          fieldType,
          options: options ?? null,
          isRequired: !!isRequired,
          displayOrder: nextDisplayOrder,
          createdBy: "tenant_admin",
        })
        .returning();

      return reply.code(201).send({
        success: true,
        data: {
          id: created.id,
          fieldKey: created.fieldKey,
          label: created.label,
          fieldType: created.fieldType,
          options: created.options,
          isRequired: created.isRequired,
          displayOrder: created.displayOrder,
          scope: "tenant",
          isSystem: false,
        },
      });
    },
  );

  // PATCH /tenant/form-fields/:fieldId — spec FR-003/FR-004/FR-009, gated forms.manage.tenant.
  // RLS scopes the caller's write to their own tenant's rows only — a global field's id simply
  // resolves as not-found here, never a silent no-op (US3, contracts/custom-fields-api.md).
  fastify.patch<{ Params: { fieldId: string }; Body: PatchFieldBody }>(
    "/tenant/form-fields/:fieldId",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("forms.manage.tenant", "forms.tenant.edit"),
      ],
    },
    async (request, reply) => {
      const { fieldId } = request.params;
      const tenantId = request.user!.tenantId;

      const [existing] = await request.tenantDb
        .select()
        .from(formFields)
        .where(and(eq(formFields.id, fieldId), eq(formFields.tenantId, tenantId)));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      if (body.fieldType && !FIELD_TYPES.includes(body.fieldType)) {
        return reply.code(400).send({ success: false, message: "Unrecognized fieldType" });
      }

      const [updated] = await request.tenantDb
        .update(formFields)
        .set({
          ...(body.label !== undefined ? { label: body.label.trim() } : {}),
          ...(body.fieldType !== undefined ? { fieldType: body.fieldType } : {}),
          ...(body.options !== undefined ? { options: body.options } : {}),
          ...(body.isRequired !== undefined ? { isRequired: body.isRequired } : {}),
          ...(body.archived ? { archivedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(formFields.id, fieldId))
        .returning();

      return reply.code(200).send({
        success: true,
        data: {
          id: updated.id,
          fieldKey: updated.fieldKey,
          label: updated.label,
          fieldType: updated.fieldType,
          options: updated.options,
          isRequired: updated.isRequired,
          displayOrder: updated.displayOrder,
          scope: "tenant",
          isSystem: false,
        },
      });
    },
  );

  // PUT /tenant/form-fields/reorder — the entire form's field layout (system + global + tenant),
  // reordered as one flat sequence, gated forms.manage.tenant. Direct product feedback supersedes
  // this framework's original "tenant fields only reorder among themselves" rule — a tenant admin
  // can now rearrange the whole form as they see fit, though a system/global field's own
  // label/type/required stays exactly as seeded/set by its owner, only its *position* moves.
  fastify.put<{ Body: { formKey?: string; fieldIds?: string[] } }>(
    "/tenant/form-fields/reorder",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("forms.manage.tenant", "forms.tenant.edit"),
      ],
    },
    async (request, reply) => {
      const { formKey, fieldIds } = request.body ?? {};
      if (!formKey || !fieldIds || fieldIds.length === 0) {
        return reply.code(400).send({ success: false, message: "formKey and fieldIds are required" });
      }

      const [definition] = await request.tenantDb
        .select({ id: formDefinitions.id })
        .from(formDefinitions)
        .where(eq(formDefinitions.key, formKey));
      if (!definition) {
        return reply.code(404).send({ success: false, message: "Unknown form type" });
      }

      const tenantId = request.user!.tenantId;
      for (const [index, fieldId] of fieldIds.entries()) {
        const [existingOverride] = await request.tenantDb
          .select({ id: formFieldOrderOverrides.id })
          .from(formFieldOrderOverrides)
          .where(and(eq(formFieldOrderOverrides.tenantId, tenantId), eq(formFieldOrderOverrides.fieldId, fieldId)));
        if (existingOverride) {
          await request.tenantDb
            .update(formFieldOrderOverrides)
            .set({ displayOrder: index, updatedAt: new Date() })
            .where(eq(formFieldOrderOverrides.id, existingOverride.id));
        } else {
          await request.tenantDb.insert(formFieldOrderOverrides).values({
            tenantId,
            formDefinitionId: definition.id,
            fieldId,
            displayOrder: index,
          });
        }
      }

      const data = await getFormFields(request.tenantDb, formKey);
      return { success: true, data };
    },
  );

  // GET /tenant/custom-field-values?formKey=&entityId= — same "no separate permission" reasoning as
  // GET /tenant/form-fields (research.md §4, spec FR-010).
  fastify.get<{ Querystring: { formKey?: string; entityId?: string } }>(
    "/tenant/custom-field-values",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { formKey, entityId } = request.query;
      if (!formKey || !entityId) {
        return reply.code(400).send({ success: false, message: "formKey and entityId are required" });
      }

      const [definition] = await request.tenantDb
        .select({ id: formDefinitions.id })
        .from(formDefinitions)
        .where(eq(formDefinitions.key, formKey));
      if (!definition) {
        return { success: true, data: {} };
      }

      const rows = await request.tenantDb
        .select({ fieldKey: formFields.fieldKey, value: customFieldValues.value })
        .from(customFieldValues)
        .innerJoin(formFields, eq(formFields.id, customFieldValues.fieldId))
        .where(and(eq(customFieldValues.formDefinitionId, definition.id), eq(customFieldValues.entityId, entityId)));

      const data = Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));
      return { success: true, data };
    },
  );

  // PUT /tenant/custom-field-values — framework completeness/testability (research.md §5);
  // Department's own routes call saveCustomFieldValues directly instead, for atomicity with the
  // department write itself.
  fastify.put<{ Body: { formKey?: string; entityId?: string; values?: Record<string, unknown> } }>(
    "/tenant/custom-field-values",
    { preHandler: [requireTenantUserSession()] },
    async (request, reply) => {
      const { formKey, entityId, values } = request.body ?? {};
      if (!formKey || !entityId) {
        return reply.code(400).send({ success: false, message: "formKey and entityId are required" });
      }

      const fields = await getFormFields(request.tenantDb, formKey);
      const result = await saveCustomFieldValues(
        request.tenantDb,
        request.user!.tenantId,
        formKey,
        entityId,
        values ?? {},
        fields,
      );
      if (result.errors) {
        return reply.code(422).send({ success: false, errors: result.errors });
      }
      return { success: true };
    },
  );
};

export default tenantFormRoutes;
