import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { customFieldValues } from "../../src/db/schema/custom-fields";

/** Form Builder spec (033), User Story 6 — covers tasks.md T056/T057: republishing a form
 * carries a tenant customization forward automatically when its anchor section still exists
 * (matched by stable `key`, spec FR-025), and a value stored under one version remains correctly
 * attributable to that version after a later version is published (spec FR-032). */
describe("form builder: version reconciliation and submission versioning", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("carries a tenant field forward across a republish when its section key is unchanged", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const key = `test_reconcile_${randomUUID().slice(0, 8)}`;
      const createFormRes = await server.inject({
        method: "POST",
        url: "/platform/forms",
        headers: adminHeaders,
        payload: { name: "Reconciliation Test", key, description: "d" },
      });
      const formId = createFormRes.json().data.id as string;

      const draftV1Res = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders });
      const v1Id = draftV1Res.json().data.id as string;
      await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${v1Id}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "general", title: "General", displayOrder: 0 }],
          fields: [{ sectionKey: "general", label: "Notes", fieldType: "textarea", displayOrder: 0 }],
        },
      });
      await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v1Id}/publish`, headers: adminHeaders });

      const tenantId = randomUUID();
      await seedTenant(tenantId);
      const userId = randomUUID();
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);
      const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const addFieldRes = await server.inject({
        method: "POST",
        url: `/tenant/forms/${key}/fields`,
        headers: tenantHeaders,
        payload: { label: "Cost Centre", fieldType: "text", sectionKey: "general" },
      });
      expect(addFieldRes.statusCode).toBe(201);

      // Republish v2 with the SAME section key ("general") but a different title — the tenant's
      // field, anchored by key, should re-attach automatically with no `needsReview` flag.
      const draftV2Res = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders, payload: { cloneFrom: "active" } });
      const v2Id = draftV2Res.json().data.id as string;
      await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${v2Id}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "general", title: "General Info (renamed)", displayOrder: 0 }],
          fields: [{ sectionKey: "general", label: "Notes", fieldType: "textarea", displayOrder: 0 }],
        },
      });
      await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v2Id}/publish`, headers: adminHeaders });

      const effectiveAfterV2 = (await server.inject({ method: "GET", url: `/tenant/forms/${key}/effective`, headers: tenantHeaders })).json().data;
      const allFields = effectiveAfterV2.steps.flatMap((s: { sections: { key: string; fields: { label: string; needsReview: boolean }[] }[] }) => s.sections.flatMap((sec) => sec.fields));
      const costCentre = allFields.find((f: { label: string }) => f.label === "Cost Centre");
      expect(costCentre).toBeDefined();
      expect(costCentre.needsReview).toBe(false);

      // Republish v3 with the section REMOVED entirely — the tenant's field must survive (not be
      // deleted) and be flagged for review, never silently dropped or silently mislocated.
      const draftV3Res = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders, payload: { cloneFrom: "active" } });
      const v3Id = draftV3Res.json().data.id as string;
      await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${v3Id}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "other", title: "Other Info", displayOrder: 0 }],
          fields: [{ sectionKey: "other", label: "Notes", fieldType: "textarea", displayOrder: 0 }],
        },
      });
      await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v3Id}/publish`, headers: adminHeaders });

      const effectiveAfterV3 = (await server.inject({ method: "GET", url: `/tenant/forms/${key}/effective`, headers: tenantHeaders })).json().data;
      const allFieldsV3 = effectiveAfterV3.steps.flatMap((s: { sections: { fields: { label: string; needsReview: boolean }[] }[] }) => s.sections.flatMap((sec) => sec.fields));
      const costCentreV3 = allFieldsV3.find((f: { label: string }) => f.label === "Cost Centre");
      expect(costCentreV3).toBeDefined();
      expect(costCentreV3.needsReview).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("keeps a submitted custom field value attributable to the form version active when it was captured", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const key = `test_versioning_${randomUUID().slice(0, 8)}`;
      const createFormRes = await server.inject({
        method: "POST",
        url: "/platform/forms",
        headers: adminHeaders,
        payload: { name: "Submission Versioning Test", key, description: "d" },
      });
      const formId = createFormRes.json().data.id as string;

      const draftV1Res = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders });
      const v1Id = draftV1Res.json().data.id as string;
      await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${v1Id}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "general", title: "General", displayOrder: 0 }],
          fields: [{ sectionKey: "general", label: "Notes", fieldType: "textarea", displayOrder: 0 }],
        },
      });
      await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v1Id}/publish`, headers: adminHeaders });

      const tenantId = randomUUID();
      await seedTenant(tenantId);
      const userId = randomUUID();
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);
      const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const entityId = randomUUID();
      const saveValuesRes = await server.inject({
        method: "PUT",
        url: "/tenant/custom-field-values",
        headers: tenantHeaders,
        payload: { formKey: key, entityId, values: { notes: "captured under v1" } },
      });
      expect(saveValuesRes.statusCode).toBe(200);

      // Publish v2 — the historical value's `form_version_id` must still point at v1, not v2.
      const draftV2Res = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders, payload: { cloneFrom: "active" } });
      const v2Id = draftV2Res.json().data.id as string;
      await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${v2Id}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "general", title: "General", displayOrder: 0 }],
          fields: [
            { sectionKey: "general", label: "Notes", fieldType: "textarea", displayOrder: 0 },
            { sectionKey: "general", label: "Extra Field", fieldType: "text", displayOrder: 1 },
          ],
        },
      });
      await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v2Id}/publish`, headers: adminHeaders });

      const readBackRes = await server.inject({
        method: "GET",
        url: `/tenant/custom-field-values?formKey=${key}&entityId=${entityId}`,
        headers: tenantHeaders,
      });
      expect(readBackRes.statusCode).toBe(200);
      expect(readBackRes.json().data.notes).toBe("captured under v1");
      expect(v1Id).not.toBe(v2Id);

      // The actual assertion FR-032 cares about: the stored row's `form_version_id` still points
      // at v1 — the version active when it was written — even though v2 is now the active
      // version for this form type. `GET /tenant/custom-field-values` doesn't surface this
      // column, so check the row directly.
      const storedRow = await withTenantDb(tenantId, async (db) => {
        const [row] = await db.select({ formVersionId: customFieldValues.formVersionId }).from(customFieldValues).where(eq(customFieldValues.entityId, entityId));
        return row;
      });
      expect(storedRow.formVersionId).toBe(v1Id);
    } finally {
      await server.close();
    }
  });
});
