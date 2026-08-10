import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { closeTestPool } from "../helpers/pg";

/** Form Builder spec (033), User Story 3 — covers tasks.md T041/T042: tenant isolation of
 * customizations, and the server-side rule that a required/system field can never be hidden
 * (spec FR-021/FR-022/FR-024), enforced even via a direct API call, not only hidden in the UI. */
describe("form builder: tenant isolation and visibility rules", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function publishSimpleForm(adminHeaders: Record<string, string>, server: Awaited<ReturnType<typeof buildTestServer>>) {
    const key = `test_iso_${randomUUID().slice(0, 8)}`;
    const createFormRes = await server.inject({
      method: "POST",
      url: "/platform/forms",
      headers: adminHeaders,
      payload: { name: "Isolation Test", key, description: "d" },
    });
    const formId = createFormRes.json().data.id as string;
    const draftRes = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders });
    const versionId = draftRes.json().data.id as string;
    await server.inject({
      method: "PATCH",
      url: `/platform/forms/${formId}/versions/${versionId}`,
      headers: adminHeaders,
      payload: {
        steps: [],
        sections: [{ key: "general", title: "General", displayOrder: 0 }],
        fields: [{ sectionKey: "general", label: "Notes", fieldType: "textarea", displayOrder: 0, isRequired: false }],
      },
    });
    await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${versionId}/publish`, headers: adminHeaders });
    return { key, formId };
  }

  it("keeps each tenant's added fields and hidden-field state invisible to every other tenant", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const { key } = await publishSimpleForm(adminHeaders, server);

      const tenantA = randomUUID();
      await seedTenant(tenantA);
      const userA = randomUUID();
      await seedUser(tenantA, userA);
      await seedUserWithRole(tenantA, userA, ["forms.manage.tenant"]);
      const headersA = { "x-test-user-id": userA, "x-test-tenant-id": tenantA };

      const tenantB = randomUUID();
      await seedTenant(tenantB);
      const userB = randomUUID();
      await seedUser(tenantB, userB);
      await seedUserWithRole(tenantB, userB, ["forms.manage.tenant"]);
      const headersB = { "x-test-user-id": userB, "x-test-tenant-id": tenantB };

      const addFieldRes = await server.inject({
        method: "POST",
        url: `/tenant/forms/${key}/fields`,
        headers: headersA,
        payload: { label: "Tenant A Only Field", fieldType: "text" },
      });
      expect(addFieldRes.statusCode).toBe(201);

      const effectiveA = (await server.inject({ method: "GET", url: `/tenant/forms/${key}/effective`, headers: headersA })).json().data;
      const effectiveB = (await server.inject({ method: "GET", url: `/tenant/forms/${key}/effective`, headers: headersB })).json().data;

      const labelsA = effectiveA.steps.flatMap((s: { sections: { fields: { label: string }[] }[] }) => s.sections.flatMap((sec) => sec.fields.map((f) => f.label)));
      const labelsB = effectiveB.steps.flatMap((s: { sections: { fields: { label: string }[] }[] }) => s.sections.flatMap((sec) => sec.fields.map((f) => f.label)));

      expect(labelsA).toContain("Tenant A Only Field");
      expect(labelsB).not.toContain("Tenant A Only Field");
    } finally {
      await server.close();
    }
  });

  it("rejects hiding a required field via a direct API call, even without any UI affordance to attempt it", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const key = `test_required_${randomUUID().slice(0, 8)}`;
      const createFormRes = await server.inject({
        method: "POST",
        url: "/platform/forms",
        headers: adminHeaders,
        payload: { name: "Required Field Test", key, description: "d" },
      });
      const formId = createFormRes.json().data.id as string;
      const draftRes = await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions`, headers: adminHeaders });
      const versionId = draftRes.json().data.id as string;
      await server.inject({
        method: "PATCH",
        url: `/platform/forms/${formId}/versions/${versionId}`,
        headers: adminHeaders,
        payload: {
          steps: [],
          sections: [{ key: "general", title: "General", displayOrder: 0 }],
          fields: [{ sectionKey: "general", label: "Required Field", fieldType: "text", displayOrder: 0, isRequired: true }],
        },
      });
      await server.inject({ method: "POST", url: `/platform/forms/${formId}/versions/${versionId}/publish`, headers: adminHeaders });

      const tenantId = randomUUID();
      await seedTenant(tenantId);
      const userId = randomUUID();
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const effective = (await server.inject({ method: "GET", url: `/tenant/forms/${key}/effective`, headers })).json().data;
      const requiredField = effective.steps.flatMap((s: { sections: { fields: { id: string; label: string }[] }[] }) => s.sections.flatMap((sec) => sec.fields)).find((f: { label: string }) => f.label === "Required Field");

      const hideRes = await server.inject({
        method: "PATCH",
        url: `/tenant/forms/${key}/fields/${requiredField.id}/visibility`,
        headers,
        payload: { hidden: true },
      });
      expect(hideRes.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});
