import { describe, expect, it } from "vitest";
import { validateFieldValue } from "./validate-field";
import type { FormField } from "../../types/field";

function field(overrides: Partial<FormField>): FormField {
  return {
    id: "f1",
    fieldKey: "test_field",
    label: "Test Field",
    description: null,
    placeholder: null,
    fieldType: "text",
    options: null,
    defaultValue: null,
    validation: null,
    isRequired: false,
    displayOrder: 0,
    layout: { colSpan: 12 },
    scope: "platform",
    isSystem: false,
    needsReview: false,
    ...overrides,
  };
}

/** Form Builder spec (033), User Story 2 (tasks.md T033) — `FormRenderer.handleNext` blocks
 * step navigation by calling this exact function against every field on the current step; this
 * is the logic under test, since this package has no DOM-rendering test harness installed
 * (`@testing-library/react` is not a dependency anywhere in this repo, and Constitution
 * Principle XIII requires sign-off before adding one — see specs/033-form-builder/tasks.md T017).
 */
describe("validateFieldValue — required-field gate (spec FR-019)", () => {
  it("blocks an empty required field", () => {
    const result = validateFieldValue(field({ isRequired: true }), "");
    expect(result).toBe("Test Field is required");
  });

  it("blocks a required field with no value at all", () => {
    expect(validateFieldValue(field({ isRequired: true }), undefined)).not.toBeNull();
  });

  it("allows an empty optional field through", () => {
    expect(validateFieldValue(field({ isRequired: false }), "")).toBeNull();
  });

  it("allows a filled required field through", () => {
    expect(validateFieldValue(field({ isRequired: true }), "some value")).toBeNull();
  });

  it("rejects a select value outside the configured options", () => {
    const f = field({ fieldType: "select", options: ["a", "b"], isRequired: true });
    expect(validateFieldValue(f, "c")).not.toBeNull();
    expect(validateFieldValue(f, "a")).toBeNull();
  });

  it("rejects a non-numeric value for a number field", () => {
    const f = field({ fieldType: "number" });
    expect(validateFieldValue(f, "not a number" as unknown as number)).not.toBeNull();
    expect(validateFieldValue(f, 42)).toBeNull();
  });

  it("enforces min/max validation constraints on a number field", () => {
    const f = field({ fieldType: "number", validation: { min: 1, max: 5 } });
    expect(validateFieldValue(f, 0)).not.toBeNull();
    expect(validateFieldValue(f, 6)).not.toBeNull();
    expect(validateFieldValue(f, 3)).toBeNull();
  });

  it("rejects a malformed email address", () => {
    const f = field({ fieldType: "email" });
    expect(validateFieldValue(f, "not-an-email")).not.toBeNull();
    expect(validateFieldValue(f, "person@example.com")).toBeNull();
  });
});
