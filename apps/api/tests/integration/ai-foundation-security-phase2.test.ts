import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedSuperAdminSession } from "../helpers/fixtures";
import { withTenantDb, closeTestPool } from "../helpers/pg";
import { formFields } from "../../src/db/schema/custom-fields";
import { aiConversations } from "../../src/db/schema/ai";
import { invokeTool, confirmToolExecution, ToolPermissionDeniedError, ToolNotFoundError, type ToolInvocationResult } from "../../src/ai/execution-state-machine";
import "../../src/ai/tools";
import type { ToolContext } from "../../src/ai/types";

/**
 * "Make the AI Foundation Usable End-to-End" Phase 2, Section 13 — the specific security
 * scenarios that phase called out beyond what `ai-foundation-forms.test.ts` (Phase 1) already
 * covered: same-tenant user isolation on confirm, context-spoofing resistance, and proof the
 * confirm/execute architecture doesn't depend on the chat endpoint being the only way in (MCP
 * preparation). Tenant isolation, permission revocation, expiry, and double-execution are already
 * covered in `ai-foundation-forms.test.ts` and not repeated here.
 */

async function createTestForm(adminHeaders: Record<string, string>, server: Awaited<ReturnType<typeof buildTestServer>>): Promise<string> {
  const key = `test_sec2_${randomUUID().slice(0, 8)}`;
  const res = await server.inject({
    method: "POST",
    url: "/platform/forms",
    headers: adminHeaders,
    payload: { name: "Phase 2 Security Test Form", key, description: "Seeded for Phase 2 security tests." },
  });
  expect(res.statusCode).toBe(201);
  return key;
}

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

function readField(tenantId: string, fieldKey: string) {
  return withTenantDb(tenantId, (db) => db.select().from(formFields).where(eq(formFields.fieldKey, fieldKey)));
}

async function seedConversation(tenantId: string, userId: string, conversationId: string): Promise<void> {
  await withTenantDb(tenantId, (db) => db.insert(aiConversations).values({ id: conversationId, tenantId, userId }));
}

describe("AI Foundation Phase 2 — user isolation on confirm (same tenant)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("User A's proposal cannot be confirmed by User B in the same tenant, via the HTTP route", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userAId = randomUUID();
      const userBId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userAId, { email: `user-a-${randomUUID()}@example.com` });
      await seedUser(tenantId, userBId, { email: `user-b-${randomUUID()}@example.com` });
      // Both users hold the permission — proves the block is ownership, not a permission gap.
      await seedUserWithRole(tenantId, userAId, ["forms.manage.tenant"]);
      await seedUserWithRole(tenantId, userBId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userAId, conversationId);
      const proposal = await propose(tenantId, userAId, "create_form_field", { formKey, label: "User A's Field", fieldType: "text" }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");

      const server2 = server; // same server instance, different request identity
      const crossUserRes = await server2.inject({
        method: "POST",
        url: `/ai/tool-executions/${proposal.executionId}/confirm`,
        headers: { "x-test-user-id": userBId, "x-test-tenant-id": tenantId },
      });
      expect(crossUserRes.statusCode).toBe(404);

      // Never executed by User B's attempt.
      expect(await readField(tenantId, "user_a_s_field")).toHaveLength(0);

      // User A can still confirm their own proposal afterward — B's failed attempt didn't
      // corrupt or consume it.
      const ownConfirm = await confirm(tenantId, userAId, proposal.executionId);
      expect(ownConfirm.status).toBe("executed");
    } finally {
      await server.close();
    }
  });

  it("User A's proposal cannot be confirmed by User B directly through confirmToolExecution either (not just the HTTP layer)", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);
      const tenantId = randomUUID();
      const userAId = randomUUID();
      const userBId = randomUUID();
      await seedTenant(tenantId);
      await seedUser(tenantId, userAId);
      await seedUser(tenantId, userBId, { email: `user-b-${randomUUID()}@example.com` });
      await seedUserWithRole(tenantId, userAId, ["forms.manage.tenant"]);
      await seedUserWithRole(tenantId, userBId, ["forms.manage.tenant"]);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userAId, conversationId);
      const proposal = await propose(tenantId, userAId, "create_form_field", { formKey, label: "Owned By A", fieldType: "text" }, conversationId);

      await expect(confirm(tenantId, userBId, proposal.executionId)).rejects.toBeInstanceOf(ToolNotFoundError);
      expect(await readField(tenantId, "owned_by_a")).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});

describe("AI Foundation Phase 2 — context spoofing resistance", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("fabricated authorization-shaped fields inside a tool call's input never influence the permission check or which tenant is written to", async () => {
    const { cookieHeader } = await seedSuperAdminSession();
    const server = await buildTestServer();
    try {
      const formKey = await createTestForm({ cookie: cookieHeader }, server);

      const tenantId = randomUUID();
      const otherTenantId = randomUUID();
      const userId = randomUUID();
      await seedTenant(tenantId, "Real Tenant");
      await seedTenant(otherTenantId, "Spoofed Tenant");
      await seedUser(tenantId, userId);
      // Deliberately NO forms.manage.tenant permission — this is the "user without permission
      // tries to talk their way past it" scenario.
      await seedUserWithRole(tenantId, userId, []);

      const conversationId = randomUUID();
      await seedConversation(tenantId, userId, conversationId);

      // A spoofed input carrying exactly the shape a naive implementation might mistake for
      // authorization: a tenantId pointing elsewhere, and permission/role-shaped fields claiming
      // elevated access. `create_form_field`'s Zod schema only reads the fields it declares
      // (label/fieldType/etc.) — everything else is inert — and the permission check reads only
      // the session's real DB roles via `ctx.userId`, never anything from `input`.
      const spoofedInput = {
        formKey,
        label: "Spoofed Field",
        fieldType: "text",
        tenantId: otherTenantId,
        permissions: ["forms.manage.tenant"],
        isSuperAdmin: true,
        role: "super_admin",
        __authorized: true,
      };

      await expect(propose(tenantId, userId, "create_form_field", spoofedInput, conversationId)).rejects.toBeInstanceOf(ToolPermissionDeniedError);

      expect(await readField(tenantId, "spoofed_field")).toHaveLength(0);
      expect(await readField(otherTenantId, "spoofed_field")).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("a page-context hint (formKey) sent alongside a chat message cannot substitute for a real permission — the message endpoint still resolves tenant/user from the session, not from the hint", async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await seedTenant(tenantId);
    await seedUser(tenantId, userId);
    // No role/permissions at all.
    const headers = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };

    const server = await buildTestServer();
    try {
      const createRes = await server.inject({ method: "POST", url: "/ai/conversations", headers });
      const conversationId = createRes.json().data.id as string;

      // No AI_PROVIDER_API_KEY in the test environment, so this never reaches tool-calling — the
      // point here is narrower and still meaningful: confirm the endpoint accepts an arbitrary
      // client-supplied `context` object without erroring or behaving differently based on its
      // contents (e.g. no special-cased "trust the context tenant" branch anywhere in the route).
      const res = await server.inject({
        method: "POST",
        url: `/ai/conversations/${conversationId}/messages`,
        headers,
        payload: { content: "Add a field", context: { formKey: "member", tenantId: randomUUID(), isSuperAdmin: true } },
      });
      // 503 (AI not configured) — the same outcome as sending no context at all — proves the
      // request reached the same code path regardless of what the spoofed context claimed.
      expect(res.statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });
});

describe("AI Foundation Phase 2 — MCP preparation: the execution architecture is not chat-dependent", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("a proposal created without ever calling the chat endpoint can be confirmed through the plain HTTP confirmation route — proving a future non-chat caller (MCP) needs no new confirmation mechanism", async () => {
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

      // Proposes by calling the tool registry directly — exactly what a future MCP server would
      // do (resolve its own agent identity to a ToolContext, call invokeTool), never touching
      // `POST /ai/conversations/:id/messages` or any AI provider at all.
      const proposal = await propose(tenantId, userId, "create_form_field", { formKey, label: "MCP Style Proposal", fieldType: "text" }, conversationId);
      expect(proposal.status).toBe("pending_confirmation");

      // Confirms through the plain HTTP route — the same one the web UI's ProposalCard calls —
      // with no dependency on how the proposal was created.
      const confirmRes = await server.inject({
        method: "POST",
        url: `/ai/tool-executions/${proposal.executionId}/confirm`,
        headers: { "x-test-user-id": userId, "x-test-tenant-id": tenantId },
      });
      expect(confirmRes.statusCode).toBe(200);
      expect(confirmRes.json().data.status).toBe("executed");
      expect(await readField(tenantId, "mcp_style_proposal")).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
