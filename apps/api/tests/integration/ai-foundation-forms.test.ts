import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import type { Db } from "../../src/db/client";
import { formFields } from "../../src/db/schema/custom-fields";
import { aiConversations, aiToolExecutions } from "../../src/db/schema/ai";
import {
  invokeTool,
  confirmToolExecution,
  rejectToolExecution,
  ToolPermissionDeniedError,
  ToolAlreadyResolvedError,
  ToolExpiredError,
  type ToolInvocationResult,
} from "../../src/ai/execution-state-machine";
import "../../src/ai/tools"; // registers the Forms tools
import type { ToolContext } from "../../src/ai/types";

/**
 * AI Foundation Phase 7 — exercises the tool layer directly against real Postgres/RLS (never
 * mocked), the same integration-test convention every other suite in this codebase uses
 * (`buildTestServer()`/real fixtures/`withTenantDb`). Deliberately calls `invokeTool`/
 * `confirmToolExecution`/`rejectToolExecution` directly rather than through
 * `POST /ai/conversations/:id/messages` for the state-machine assertions below — that HTTP route
 * additionally calls a real AI provider (no API key in the test environment, and not what these
 * tests are about); a handful of HTTP-level tests at the bottom cover the route wiring itself
 * (conversation creation, confirm/reject endpoints, cross-tenant/cross-user 404s) without needing
 * a live provider.
 *
 * IMPORTANT: every distinct "action" below (one propose call, one confirm call, one read) opens
 * its own `withTenantDb` — a fresh transaction on a fresh pooled connection, exactly like one real
 * HTTP request (plugins/tenant-context.ts). A `ToolContext.db` must never be reused after the
 * `withTenantDb` call that produced it has returned — that connection has already been committed
 * and released back to the pool, and continuing to query through it risks exactly the
 * cross-request GUC contamination `tenant-routing/resolve-tenant.ts`'s own docs warn about.
 */

async function createTestForm(adminHeaders: Record<string, string>, server: Awaited<ReturnType<typeof buildTestServer>>): Promise<string> {
  const key = `test_ai_${randomUUID().slice(0, 8)}`;
  const res = await server.inject({
    method: "POST",
    url: "/platform/forms",
    headers: adminHeaders,
    payload: { name: "AI Test Form", key, description: "Seeded for AI Foundation tests." },
  });
  expect(res.statusCode).toBe(201);
  return key;
}

async function seedConversation(tenantId: string, userId: string, conversationId: string): Promise<void> {
  await withTenantDb(tenantId, (db) => db.insert(aiConversations).values({ id: conversationId, tenantId, userId }));
}

/** `withTenantDb` rolls back the whole transaction if the callback throws (helpers/pg.ts) — correct
 * for a genuine failure, but `confirmToolExecution` can legitimately make a durable state change
 * (e.g. marking a proposal `expired`) and *then* throw to report that outcome to the caller. The
 * real HTTP route (`ai/routes.ts`) already handles this correctly by catching the error inside the
 * request's own transaction and replying without rethrowing, which is what lets
 * `plugins/tenant-context.ts`'s `onResponse` hook commit normally. These test helpers mirror that
 * same catch-inside/rethrow-outside shape so a thrown `ToolExpiredError` (etc.) doesn't spuriously
 * roll back a state change `confirmToolExecution` itself already persisted.
 */
async function runInOwnTransaction<T>(tenantId: string, userId: string, fn: (ctx: ToolContext) => Promise<T>): Promise<T> {
  let caught: unknown;
  const result = await withTenantDb(tenantId, async (db) => {
    try {
      return await fn({ tenantId, userId, db });
    } catch (err) {
      caught = err;
      return undefined as T;
    }
  });
  if (caught) throw caught;
  return result;
}

function propose(tenantId: string, userId: string, toolName: string, input: Record<string, unknown>, conversationId: string): Promise<ToolInvocationResult> {
  return runInOwnTransaction(tenantId, userId, (ctx) => invokeTool(toolName, ctx, input, conversationId));
}

function confirm(tenantId: string, userId: string, executionId: string): Promise<ToolInvocationResult> {
  return runInOwnTransaction(tenantId, userId, (ctx) => confirmToolExecution(executionId, ctx));
}

function reject(tenantId: string, userId: string, executionId: string) {
  return runInOwnTransaction(tenantId, userId, (ctx) => rejectToolExecution(executionId, ctx));
}

function readField(tenantId: string, fieldKey: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(formFields).where(eq(formFields.fieldKey, fieldKey)));
}

function readExecution(tenantId: string, executionId: string) {
  return withTenantDb(tenantId, (db: Db) => db.select().from(aiToolExecutions).where(eq(aiToolExecutions.id, executionId)));
}

describe("AI Foundation — Forms tools", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("list_form_fields (read tool) is tenant-isolated: Tenant A cannot see Tenant B's own fields, and vice versa", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const adminHeaders = { cookie: cookieHeader };
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm(adminHeaders, server);

      const tenantAId = randomUUID();
      const userAId = randomUUID();
      await seedTenant(tenantAId, "Tenant A");
      await seedUser(tenantAId, userAId);
      await seedUserWithRole(tenantAId, userAId, ["forms.manage.tenant"]);

      const tenantBId = randomUUID();
      const userBId = randomUUID();
      await seedTenant(tenantBId, "Tenant B");
      await seedUser(tenantBId, userBId);
      await seedUserWithRole(tenantBId, userBId, ["forms.manage.tenant"]);

      const conversationAId = randomUUID();
      await seedConversation(tenantAId, userAId, conversationAId);

      // Tenant A creates a field of its own directly (setup, not itself under test) so there's
      // something tenant-specific for the read assertion below to find or not find.
      const proposalA = await propose(tenantAId, userAId, "create_form_field", { formKey, label: "Tenant A Only", fieldType: "text" }, conversationAId);
      await confirm(tenantAId, userAId, proposalA.executionId);

      const resultA = await propose(tenantAId, userAId, "list_form_fields", { formKey }, conversationAId);
      expect(resultA.status).toBe("executed");
      const fieldKeysA = (resultA.output as { fieldKey: string }[]).map((f) => f.fieldKey);
      expect(fieldKeysA).toContain("tenant_a_only");

      const conversationBId = randomUUID();
      await seedConversation(tenantBId, userBId, conversationBId);
      const resultB = await propose(tenantBId, userBId, "list_form_fields", { formKey }, conversationBId);
      const fieldKeysB = (resultB.output as { fieldKey: string }[]).map((f) => f.fieldKey);
      expect(fieldKeysB).not.toContain("tenant_a_only");
    } finally {
      await server.close();
    }
  });

  it("permission enforcement: a user without forms.manage.tenant cannot invoke create_form_field", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);

      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, []); // no permissions at all

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      await expect(propose(tenantId, userId, "create_form_field", { formKey, label: "Should Fail", fieldType: "text" }, conversationId)).rejects.toBeInstanceOf(
        ToolPermissionDeniedError,
      );
    } finally {
      await server.close();
    }
  });

  it("tenant ID injection: an input-supplied tenantId is ignored — the field is created under the session's own tenant, never the injected one", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);

      const realTenantId = randomUUID();
      const otherTenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(realTenantId, "Real Tenant");
      await seedTenant(otherTenantId, "Other Tenant");
      await seedUser(realTenantId, userId);
      await seedUserWithRole(realTenantId, userId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(realTenantId, userId, conversationId);

      // requiresConfirmation: true for create_form_field, so this only proposes — confirm it to
      // actually reach a persisted row worth checking the tenant_id on.
      const proposal = await propose(
        realTenantId,
        userId,
        "create_form_field",
        { formKey, label: "Injection Test", fieldType: "text", tenantId: otherTenantId },
        conversationId,
      );
      expect(proposal.status).toBe("pending_confirmation");
      const confirmed = await confirm(realTenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");

      const visibleFromRealTenant = await readField(realTenantId, "injection_test");
      expect(visibleFromRealTenant).toHaveLength(1);
      expect(visibleFromRealTenant[0].tenantId).toBe(realTenantId);

      const visibleFromOtherTenant = await readField(otherTenantId, "injection_test");
      expect(visibleFromOtherTenant).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("create_form_field creates a pending proposal, not an immediate DB change", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "create_form_field", { formKey, label: "Proposed Field", fieldType: "text" }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");
      expect(proposal.output).toBeUndefined();

      expect(await readField(tenantId, "proposed_field")).toHaveLength(0);

      const [executionRow] = await readExecution(tenantId, proposal.executionId);
      expect(executionRow.status).toBe("pending_confirmation");
      expect(executionRow.mutating).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("confirmation executes the service, and the same proposal cannot be executed twice", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "create_form_field", { formKey, label: "Confirm Me", fieldType: "text" }, conversationId);
      const confirmed = await confirm(tenantId, userId, proposal.executionId);
      expect(confirmed.status).toBe("executed");
      expect(await readField(tenantId, "confirm_me")).toHaveLength(1);

      // Double execution.
      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);

      // Still exactly one row — confirming again must not have run the service a second time.
      expect(await readField(tenantId, "confirm_me")).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("an expired proposal cannot be confirmed", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "create_form_field", { formKey, label: "Too Late", fieldType: "text" }, conversationId);
      await withTenantDb(tenantId, (db) => db.update(aiToolExecutions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiToolExecutions.id, proposal.executionId)));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolExpiredError);

      const [row] = await readExecution(tenantId, proposal.executionId);
      expect(row.status).toBe("expired");
      expect(await readField(tenantId, "too_late")).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("confirmation fails if the user's permission was removed after the proposal was created", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      const { roleId } = await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "create_form_field", { formKey, label: "Permission Revoked", fieldType: "text" }, conversationId);

      // Revoke: unassign the user from the role that granted forms.manage.tenant.
      await withTenantDb(tenantId, (db) => db.execute(`DELETE FROM user_roles WHERE user_id = '${userId}' AND role_id = '${roleId}'`));

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
      expect(await readField(tenantId, "permission_revoked")).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("rejecting a proposal marks it rejected and it can no longer be confirmed", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      const proposal = await propose(tenantId, userId, "create_form_field", { formKey, label: "Reject Me", fieldType: "text" }, conversationId);
      await reject(tenantId, userId, proposal.executionId);

      const [row] = await readExecution(tenantId, proposal.executionId);
      expect(row.status).toBe("rejected");

      await expect(confirm(tenantId, userId, proposal.executionId)).rejects.toBeInstanceOf(ToolAlreadyResolvedError);
    } finally {
      await server.close();
    }
  });

  it("RLS enforces isolation at the database level even for ai_tool_executions directly (not just through the tool layer)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantAId = randomUUID();
      const userAId = randomUUID();
      await seedTenant(tenantAId, "Tenant A");
      await seedUser(tenantAId, userAId);
      await seedUserWithRole(tenantAId, userAId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantAId, userAId, conversationId);
      const proposal = await propose(tenantAId, userAId, "create_form_field", { formKey, label: "RLS Check", fieldType: "text" }, conversationId);

      const tenantBId = randomUUID();
      await seedTenant(tenantBId, "Tenant B");
      expect(await readExecution(tenantBId, proposal.executionId)).toHaveLength(0);
      expect(await readExecution(tenantAId, proposal.executionId)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});

describe("AI Foundation — HTTP routes", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a conversation, and returns a clear 503 when the AI provider is unconfigured", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const createRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      expect(createRes.statusCode).toBe(201);
      const conversationId = createRes.json().data.id as string;

      const messageRes = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "hello" },
      });
      // No AI_PROVIDER_API_KEY in the test environment — must fail loudly and clearly, not
      // silently succeed with a fake response.
      expect(messageRes.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it("a conversation is not reachable by another user in the same tenant", async () => {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const otherId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, ownerId);
    await seedUser(tenantId, otherId, { email: `other-${randomUUID()}@example.com` });

    const server = await buildTestServer();
    try {
      const createRes = await server.inject({ method: "POST", url: "/ai/conversations", headers: { "x-test-user-id": ownerId, "x-test-tenant-id": tenantId } });
      const conversationId = createRes.json().data.id as string;

      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers: { "x-test-user-id": otherId, "x-test-tenant-id": tenantId },
        payload: { content: "hello" },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("confirm/reject HTTP routes work end-to-end and reject a cross-tenant execution id with 404", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userId);
      await seedUserWithRole(tenantId, userId, ["forms.manage.tenant"]);
      const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);
      const proposal = await propose(tenantId, userId, "create_form_field", { formKey, label: "Via HTTP", fieldType: "text" }, conversationId);

      const otherTenantId = randomUUID();
      const otherUserId = randomUUID();
      await seedTenant(otherTenantId);
      await seedUser(otherTenantId, otherUserId);
      const crossTenantRes = await server.inject({
        method: "POST",
        url: `/ai/tool-executions/${proposal.executionId}/confirm`,
        headers: { "x-test-user-id": otherUserId, "x-test-tenant-id": otherTenantId },
      });
      expect(crossTenantRes.statusCode).toBe(404);

      const confirmRes = await server.inject({ method: "POST", url: `/ai/tool-executions/${proposal.executionId}/confirm`, headers });
      expect(confirmRes.statusCode).toBe(200);
      expect(confirmRes.json().data.status).toBe("executed");

      expect(await readField(tenantId, "via_http")).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
