import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUserWithRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";

describe("custom fields: Training Needs Analysis end-to-end (spec 014 US3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("an HR/L&D Admin adds a tenant field for training_needs_analysis via the existing forms API, ordered after the four system fields", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const hrAdminId = randomUUID();
    await seedUserWithRole(tenantId, hrAdminId, ["forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": hrAdminId, "x-test-tenant-id": tenantId };

      // The "Training Needs Analysis" form type is already selectable (0048_seed_tna_form_definition.sql).
      const definitions = await server.inject({ method: "GET", url: "/tenant/form-definitions", headers });
      expect(definitions.statusCode).toBe(200);
      expect(definitions.json().data.map((d: { key: string }) => d.key)).toContain("training_needs_analysis");

      const beforeFields = await server.inject({
        method: "GET",
        url: "/tenant/form-fields?formKey=training_needs_analysis",
        headers,
      });
      expect(beforeFields.statusCode).toBe(200);
      const systemKeys = beforeFields.json().data.map((f: { fieldKey: string }) => f.fieldKey);
      expect(systemKeys).toEqual(["title", "priority", "department_id", "status"]);

      const addField = await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers,
        payload: { formKey: "training_needs_analysis", label: "Function", fieldType: "text", isRequired: true },
      });
      expect(addField.statusCode).toBe(201);
      expect(addField.json().data.fieldKey).toBe("function");
      expect(addField.json().data.scope).toBe("tenant");

      const afterFields = await server.inject({
        method: "GET",
        url: "/tenant/form-fields?formKey=training_needs_analysis",
        headers,
      });
      const orderedKeys = afterFields.json().data.map((f: { fieldKey: string }) => f.fieldKey);
      expect(orderedKeys).toEqual(["title", "priority", "department_id", "status", "function"]);
    } finally {
      await server.close();
    }
  });

  it("enforces the new tenant field as required when a Manager submits a training need, and persists its value", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { managerId } = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId, name: `Security ${randomUUID()}` }).returning({ id: departments.id });
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Manager", email: `mgr-${randomUUID()}@example.com`, departmentId: dept.id })
        .returning({ id: users.id });
      return { managerId: manager.id };
    });
    await seedUserWithRole(tenantId, managerId, ["training_request.view.department", "training_request.manage.department", "forms.manage.tenant"]);

    const server = await buildTestServer();
    try {
      const headers = { "x-test-user-id": managerId, "x-test-tenant-id": tenantId };

      await server.inject({
        method: "POST",
        url: "/tenant/form-fields",
        headers,
        payload: { formKey: "training_needs_analysis", label: "Function", fieldType: "text", isRequired: true },
      });

      // Submitting without the required tenant field fails.
      const missingRequired = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Data Protection Training", priority: "medium", status: "submitted" },
      });
      expect(missingRequired.statusCode).toBe(422);

      // Draft is unaffected by the required-field rule (spec FR-004) — saved without it.
      const draft = await server.inject({
        method: "POST",
        url: "/tenant/training-needs",
        headers,
        payload: { title: "Data Protection Training", priority: "medium", customFieldValues: {} },
      });
      expect(draft.statusCode).toBe(201);
      const trainingNeedId = draft.json().data.id;

      // Submitting via PATCH with the field now filled succeeds and persists it.
      const submit = await server.inject({
        method: "PATCH",
        url: `/tenant/training-needs/${trainingNeedId}`,
        headers,
        payload: { status: "submitted", customFieldValues: { function: "Security Data Management" } },
      });
      expect(submit.statusCode).toBe(200);
      expect(submit.json().data.status).toBe("submitted");

      const values = await server.inject({
        method: "GET",
        url: `/tenant/custom-field-values?formKey=training_needs_analysis&entityId=${trainingNeedId}`,
        headers,
      });
      expect(values.statusCode).toBe(200);
      expect(values.json().data.function).toBe("Security Data Management");
    } finally {
      await server.close();
    }
  });
});
