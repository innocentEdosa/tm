import { pgTable, uuid, text, jsonb, boolean, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * AI Foundation Phase 4 — the minimum schema the READ → respond / WRITE → propose → confirm →
 * execute → audit state machine needs (`ai/execution-state-machine.ts`). Three tables, each
 * individually justified:
 *
 * - `ai_conversations`: there is no conversational state anywhere in this codebase today — a
 *   chat turn needs somewhere to belong.
 * - `ai_messages`: the chat history itself, and the anchor the AI Activity UI (a later phase)
 *   would render.
 * - `ai_tool_executions`: the audit/confirmation ledger — generalizes this codebase's existing
 *   bespoke per-subsystem audit tables (`tenant_action_log`, `member_action_log`,
 *   `tenant_config_action_log`) into one AI-specific log, since none of those cover AI-initiated
 *   actions and inventing a fourth bespoke table per AI domain would be exactly the kind of
 *   "speculative table" the brief warns against.
 *
 * Deliberately NOT included in this first slice (would be genuinely speculative right now):
 * `ai_usage`/`ai_configurations` (AI enablement is an env var for this foundation — see
 * `ai/provider/invoke-ai.ts` — not a per-tenant DB-configurable feature yet), and anything
 * MCP-shaped (`mcp_clients`, agent identity) — Phase 8 explicitly defers MCP.
 *
 * All three are ordinary tenant-scoped tables — a tenant admin's own conversation is their own
 * tenant's data, unlike the platform-only action-log tables above — so they get the exact same
 * `ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_isolation` treatment as `departments`/`roles`/etc.
 * (see the migration), not the RLS-exempt, SELECT/INSERT-only treatment those platform logs get.
 */

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One proposed or executed tool invocation. A read tool's row is created and resolved to
 * `status: 'executed'` in the same call (READ → authorize → execute → audit — no confirmation
 * step). A mutating tool's row is created as `status: 'pending_confirmation'` and only reaches
 * `executed`/`failed` once a human independently confirms it (`ai/execution-state-machine.ts`
 * `confirmToolExecution`) — never transitions there on its own.
 */
export const aiToolExecutions = pgTable(
  "ai_tool_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    /** Set only once a human independently confirms (never the same request that proposed it —
     * `ai/execution-state-machine.ts`'s `confirmToolExecution` re-derives this from that
     * confirmation request's own session, never copies it from the proposal). Also set (to the
     * same user who triggered it) for a read tool's immediate, no-confirmation execution, so this
     * column always means "who caused `output`/`error` to be populated." */
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    status: text("status").notNull(),
    mutating: boolean("mutating").notNull(),
    /** The permission key(s) actually checked for this execution — re-checked, not copied, at
     * confirmation time (Critical Architectural Constraint: a proposal's permission check must be
     * re-verified at confirm time, not trusted from proposal time). Recorded for audit
     * transparency, not as the enforcement mechanism itself. */
    permissionChecked: jsonb("permission_checked").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** `NULL` for a read tool (executed immediately, nothing to expire). Set for a mutating
     * proposal — `ai/execution-state-machine.ts` enforces this, not a DB trigger. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "ai_tool_executions_status_check",
      sql`${table.status} IN ('pending_confirmation', 'executed', 'rejected', 'failed', 'expired')`,
    ),
  ],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** Links an assistant message proposing a mutation to the specific `ai_tool_executions` row
     * awaiting confirmation, so the UI can render a Confirm/Cancel card against the right message
     * (AI UX, "Design how the UI should represent... Confirmation"). `NULL` for a plain text
     * turn or a read tool's answer (nothing to confirm). */
    toolExecutionId: uuid("tool_execution_id").references(() => aiToolExecutions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("ai_messages_role_check", sql`${table.role} IN ('user', 'assistant', 'tool')`)],
);
