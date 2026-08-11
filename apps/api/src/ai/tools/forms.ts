import { z } from "zod";
import { registerTool } from "../tool-registry";
import type { ToolContext } from "../types";
import { FormService, FIELD_TYPES } from "../../form-builder/form-service";
import { invokeAi } from "../provider/invoke-ai";
import { zodToJsonSchema } from "../provider/zod-to-json-schema";

/**
 * AI Foundation Phase 3 — the Forms domain, chosen first because it's this LMS's smallest,
 * lowest-blast-radius surface (no delete route even exists for a form field — archive-via-PATCH
 * only, per `0038_seed_granular_crud_permissions.sql`'s own documented precedent). Every tool here
 * wraps `FormService` (`form-builder/form-service.ts`) — never touches Drizzle/Postgres directly.
 */

const fieldTypeSchema = z.enum(FIELD_TYPES);

const listFormFieldsInput = z.object({
  formKey: z.string().describe("The form type's key, e.g. \"department\", \"member\", or \"training_needs_analysis\"."),
});

registerTool({
  name: "list_form_fields",
  description: "List every field currently configured on a form type (system, platform-default, and this tenant's own), including hidden ones. Read-only.",
  inputSchema: listFormFieldsInput,
  requiredPermissions: [],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await FormService.listFields(ctx, input.formKey);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const suggestFormFieldsInput = z.object({
  formKey: z.string().describe("The form type to suggest fields for."),
  description: z.string().describe("A natural-language description of what information to collect, e.g. \"emergency contact information for new hires\"."),
});

const suggestedFieldSchema = z.object({
  label: z.string(),
  fieldKey: z.string(),
  fieldType: fieldTypeSchema,
  isRequired: z.boolean(),
  options: z.array(z.string()).optional(),
  rationale: z.string().describe("One sentence on why this field is included."),
});
const suggestionSchema = z.object({ fields: z.array(suggestedFieldSchema) });

registerTool({
  name: "suggest_form_fields",
  description: "Given a natural-language description, propose a set of new field definitions for a form type. Does NOT modify the database — a pure proposal for a human (or create_form_field) to act on.",
  inputSchema: suggestFormFieldsInput,
  outputSchema: suggestionSchema,
  requiredPermissions: ["forms.manage.tenant"],
  mutating: false,
  requiresConfirmation: false,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const existing = await FormService.listFields(ctx, input.formKey);
    const existingKeys = existing.ok ? existing.data.map((f) => f.fieldKey) : [];

    const result = await invokeAi({
      messages: [
        {
          role: "system",
          content:
            "You design form fields for a multi-tenant LMS's admin-configurable forms. Given a form type and a natural-language description, propose a small, well-typed set of new fields. Never reuse an existing field key. Prefer the narrowest fieldType that fits (e.g. \"select\" over \"text\" when there's a known, small set of options). Call propose_fields exactly once with your answer.",
        },
        {
          role: "user",
          content: `Form type: ${input.formKey}\nExisting field keys: ${existingKeys.join(", ") || "(none)"}\nRequest: ${input.description}`,
        },
      ],
      tools: [{ name: "propose_fields", description: "Return the proposed field definitions.", inputSchema: zodToJsonSchema(suggestionSchema) }],
    });

    const call = result.toolCalls.find((c) => c.name === "propose_fields");
    if (!call) {
      throw new Error("The AI did not return a structured field proposal.");
    }
    const parsed = suggestionSchema.parse(call.arguments);

    const seen = new Set(existingKeys);
    const fields = parsed.fields.filter((f) => {
      if (seen.has(f.fieldKey)) return false;
      seen.add(f.fieldKey);
      return true;
    });
    return { fields };
  },
});

const createFormFieldInput = z.object({
  formKey: z.string(),
  label: z.string(),
  fieldKey: z.string().optional(),
  fieldType: fieldTypeSchema,
  description: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().optional(),
  sectionKey: z.string().optional(),
});

registerTool({
  name: "create_form_field",
  description: "Create a new field on a form type. Mutating — requires human confirmation before it takes effect.",
  inputSchema: createFormFieldInput,
  requiredPermissions: ["forms.manage.tenant"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const { formKey, ...rest } = input;
    const result = await FormService.createField(ctx, formKey, rest);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const updateFormFieldInput = z.object({
  formKey: z.string(),
  fieldId: z.string().uuid(),
  label: z.string().optional(),
  fieldType: fieldTypeSchema.optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().optional(),
  archived: z.boolean().optional(),
  sectionKey: z.string().optional(),
});

registerTool({
  name: "update_form_field",
  description: "Update (or archive, via archived: true) an existing tenant-owned field on a form type. Mutating — requires human confirmation.",
  inputSchema: updateFormFieldInput,
  requiredPermissions: ["forms.manage.tenant"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const { formKey, fieldId, ...rest } = input;
    const result = await FormService.updateField(ctx, formKey, fieldId, rest);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});

const reorderFormFieldsInput = z.object({
  formKey: z.string(),
  fieldIds: z.array(z.string().uuid()).min(1),
});

registerTool({
  name: "reorder_form_fields",
  description: "Reorder a form type's fields into the given sequence. Mutating — requires human confirmation, since it changes what every user filling out this form sees first.",
  inputSchema: reorderFormFieldsInput,
  requiredPermissions: ["forms.manage.tenant"],
  mutating: true,
  requiresConfirmation: true,
  scope: "tenant",
  async execute(ctx: ToolContext, input) {
    const result = await FormService.reorderFields(ctx, input.formKey, input.fieldIds);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
});
