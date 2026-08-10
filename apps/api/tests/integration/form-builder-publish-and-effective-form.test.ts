import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/** Form Builder spec (033), User Story 1 — covers tasks.md T015/T016: `getEffectiveForm` merge
 * ordering and publish atomicity (spec FR-007/FR-008, SC-008). Exercises the real HTTP routes
 * end to end (Super Admin builds/publishes, tenant reads the effective form) rather than calling
 * internal functions directly, matching this codebase's existing integration-test convention
 * (no unit-test layer for DB-touching logic anywhere in this repo — see
 * custom-fields-render-merge-order.test.ts for the equivalent spec-010 precedent this mirrors). */
describe("form builder: publish and effective form resolution", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("publishes a draft, resolves it as the tenant's effective form, and atomically retires the prior version on republish", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };

    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const userId = randomUUID();
    await seedUser(tenantId, userId);
    await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);
    const tenantHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const key = `test_onboarding_${randomUUID().slice(0, 8)}`;

      const createFormRes = await server.inject({
        method: "POST",
        url: "/platform/forms",
        headers: adminHeaders,
        payload: { name: "Test Onboarding", key, description: "A form created by an integration test." },
      });
      expect(createFormRes.statusCode).toBe(201);
      const formId = createFormRes.json().data.id as string;

      // Publishing an empty draft is rejected (spec Edge Cases, FR-007).
      const emptyDraftRes = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders });
      expect(emptyDraftRes.statusCode).toBe(201);
      const v1Id = emptyDraftRes.json().data.id as string;
      const rejectedPublish = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v1Id}/publish`, headers: adminHeaders });
      expect(rejectedPublish.statusCode).toBe(422);

      const patchV1Res = await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${v1Id}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "general", title: "General", displayOrder: 0 }],
          fields: [
            { sectionKey: "general", label: "Start Date", fieldType: "date", displayOrder: 0 },
            { sectionKey: "general", label: "Office", fieldType: "select", options: ["Remote", "HQ"], displayOrder: 1 },
          ],
        },
      });
      expect(patchV1Res.statusCode).toBe(200);

      const publishV1Res = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v1Id}/publish`, headers: adminHeaders });
      expect(publishV1Res.statusCode).toBe(200);
      expect(publishV1Res.json().data.status).toBe("published");

      const effectiveRes1 = await server.inject({ method: "GET", url: `/tenant/forms/${key}/effective`, headers: tenantHeaders });
      expect(effectiveRes1.statusCode).toBe(200);
      const effective1 = effectiveRes1.json().data;
      expect(effective1.formVersionId).toBe(v1Id);
      const fields1 = effective1.steps.flatMap((s: { sections: { fields: unknown[] }[] }) => s.sections.flatMap((sec) => sec.fields));
      expect(fields1.map((f: { label: string }) => f.label)).toEqual(["Start Date", "Office"]);

      // Republish: a second draft, cloned from active, with one field renamed — must atomically
      // become the sole active version (SC-008), and the tenant's effective form must reflect it
      // immediately with no window where neither/both versions are active.
      const draftV2Res = await server.inject({
        method: "POST",
        url: `/platform/forms/${formId}/versions`,
        headers: adminHeaders,
        payload: { cloneFrom: "active" },
      });
      expect(draftV2Res.statusCode).toBe(201);
      const v2Id = draftV2Res.json().data.id as string;

      const patchV2Res = await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${v2Id}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "general", title: "General", displayOrder: 0 }],
          fields: [{ sectionKey: "general", label: "Start Date (renamed)", fieldType: "date", displayOrder: 0 }],
        },
      });
      expect(patchV2Res.statusCode).toBe(200);

      const publishV2Res = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${v2Id}/publish`, headers: adminHeaders });
      expect(publishV2Res.statusCode).toBe(200);

      const versionsRes = await server.inject({ method: "GET", url: `/platform/forms/${formId}/versions`, headers: adminHeaders });
      const versions = versionsRes.json().data as { id: string; status: string }[];
      const v1 = versions.find((v) => v.id === v1Id)!;
      const v2 = versions.find((v) => v.id === v2Id)!;
      expect(v1.status).toBe("archived");
      expect(v2.status).toBe("published");

      const effectiveRes2 = await server.inject({ method: "GET", url: `/tenant/forms/${key}/effective`, headers: tenantHeaders });
      const effective2 = effectiveRes2.json().data;
      expect(effective2.formVersionId).toBe(v2Id);
      const fields2 = effective2.steps.flatMap((s: { sections: { fields: unknown[] }[] }) => s.sections.flatMap((sec) => sec.fields));
      expect(fields2.map((f: { label: string }) => f.label)).toEqual(["Start Date (renamed)"]);
    } finally {
      await server.close();
    }
  });

  it("rejects creating a second form type with a key that already exists (spec FR-002)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const key = `test_duplicate_${randomUUID().slice(0, 8)}`;
      const first = await server.inject({
        method: "POST",
        url: "/platform/forms",
        headers: adminHeaders,
        payload: { name: "First", key, description: "d" },
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: "/platform/forms",
        headers: adminHeaders,
        payload: { name: "Second", key, description: "d" },
      });
      expect(second.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });
});
