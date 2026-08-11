import { z } from "zod";

/**
 * A minimal, hand-rolled Zod → JSON-Schema converter — covers exactly the shapes this codebase's
 * tool input schemas actually use (object/string/number/boolean/array/enum/optional/nullable/
 * record), not the general case. Deliberately not the `zod-to-json-schema` npm package: one more
 * dependency for a conversion this small isn't worth it ("avoid unnecessary dependencies", AI
 * Foundation brief). Extend this function, not around it, if a tool ever needs a shape it doesn't
 * yet handle — `default: throws`, not silently wrong, so a gap is caught at tool-registration time.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def;

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(def.innerType);
  }
  if (schema instanceof z.ZodEffects) {
    return zodToJsonSchema(def.schema);
  }

  const description = schema.description ? { description: schema.description } : {};

  if (schema instanceof z.ZodString) {
    return { type: "string", ...description };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number", ...description };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean", ...description };
  }
  if (schema instanceof z.ZodLiteral) {
    return { const: def.value, ...description };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: def.values, ...description };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(def.type), ...description };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: zodToJsonSchema(def.valueType), ...description };
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return { ...description };
  }
  if (schema instanceof z.ZodObject) {
    const shape = def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape) as [string, z.ZodTypeAny][]) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodNullable) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...description,
    };
  }

  throw new Error(`zodToJsonSchema: unsupported schema type "${schema.constructor.name}" — extend this function.`);
}
