import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { departments } from "../db/schema/departments";
import { users } from "../db/schema/users";
import { logTenantConfigAction } from "./tenant-config-action-log";
import { RecordNotFoundError, DepartmentValidationError, DepartmentNameConflictError } from "./errors";

export interface DepartmentWriteInput {
  name?: string;
  parentDepartmentId?: string | null;
  description?: string;
  status?: "active" | "archived";
  managerId?: string | null;
  assistantManagerId?: string | null;
}

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/** research.md §1 — tenant-scoped equivalent of `departments/department-hierarchy.ts`'s
 * `findAncestorChain`, which relies on `request.tenantDb`'s ambient RLS scoping (no `tenant_id`
 * filter of its own). Walks upward through `parent_department_id`, filtered to this tenant only. */
async function findAncestorChainForTenant(
  db: Db,
  tenantId: string,
  startDepartmentId: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_department_id, 1 AS depth
      FROM departments
      WHERE id = ${startDepartmentId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT d.id, d.parent_department_id, c.depth + 1
      FROM departments d
      JOIN chain c ON d.id = c.parent_department_id
      WHERE d.tenant_id = ${tenantId}
    )
    SELECT id FROM chain ORDER BY depth
  `);
  return result.rows.map((row) => (row as { id: string }).id);
}

/** research.md §1 — tenant-scoped equivalent of `tenant-department-routes.ts`'s
 * `validateHierarchyAndManagers`, explicitly filtered by `tenantId` throughout. Returns a message on
 * failure, matching the tenant-side route's own wording exactly (contracts.md). */
async function validateHierarchyAndManagersForTenant(
  db: Db,
  tenantId: string,
  body: DepartmentWriteInput,
  currentId: string | undefined,
): Promise<string | null> {
  if (body.parentDepartmentId) {
    const chain = await findAncestorChainForTenant(db, tenantId, body.parentDepartmentId);
    if (chain.length === 0) {
      return "Parent department not found";
    }
    if (currentId && chain.includes(currentId)) {
      return "Cannot set a department as its own parent or descendant";
    }
    if (chain.length >= 3) {
      return "Departments can only be nested up to 3 levels deep";
    }
  }

  const managerId = body.managerId ?? undefined;
  const assistantManagerId = body.assistantManagerId ?? undefined;
  if (managerId && managerId === assistantManagerId) {
    return "Manager and Assistant Manager must be different people";
  }
  for (const userId of [managerId, assistantManagerId]) {
    if (!userId) continue;
    const [found] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    if (!found) {
      return "Manager/Assistant Manager user not found";
    }
  }

  return null;
}

function toResponseRow(d: typeof departments.$inferSelect) {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    status: d.status,
    parentDepartmentId: d.parentDepartmentId,
    managerId: d.managerId,
    assistantManagerId: d.assistantManagerId,
  };
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `POST /tenants/:id/departments` (spec FR-007).
 * Mirrors `POST /tenant/departments`'s (Spec 009) exact shape, explicitly scoped to `tenantId`
 * (research.md §1).
 */
export async function createTenantDepartment(
  db: Db,
  params: { tenantId: string; superAdminId: string; input: DepartmentWriteInput },
): Promise<ReturnType<typeof toResponseRow>> {
  const { tenantId, superAdminId, input } = params;

  const validationError = await validateHierarchyAndManagersForTenant(db, tenantId, input, undefined);
  if (validationError) {
    throw new DepartmentValidationError(validationError);
  }

  let created: typeof departments.$inferSelect;
  try {
    [created] = await db
      .insert(departments)
      .values({
        tenantId,
        name: input.name!.trim(),
        parentDepartmentId: input.parentDepartmentId ?? null,
        description: input.description ?? null,
        managerId: input.managerId ?? null,
        assistantManagerId: input.assistantManagerId ?? null,
        status: "active",
      })
      .returning();
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      throw new DepartmentNameConflictError(`Department name "${input.name}" already exists for tenant ${tenantId}`);
    }
    throw err;
  }

  await logTenantConfigAction(db, {
    tenantId,
    superAdminId,
    entityType: "department",
    entityId: created.id,
    action: "department_created",
  });

  return toResponseRow(created);
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `PATCH /tenants/:id/departments/:departmentId`
 * (spec FR-007). Mirrors `PATCH /tenant/departments/:departmentId`'s (Spec 009) exact shape.
 */
export async function editTenantDepartment(
  db: Db,
  params: { tenantId: string; departmentId: string; superAdminId: string; input: DepartmentWriteInput },
): Promise<ReturnType<typeof toResponseRow>> {
  const { tenantId, departmentId, superAdminId, input } = params;

  const [existing] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));
  if (!existing) {
    throw new RecordNotFoundError(`No department ${departmentId} for tenant ${tenantId}`);
  }

  const validationError = await validateHierarchyAndManagersForTenant(db, tenantId, input, departmentId);
  if (validationError) {
    throw new DepartmentValidationError(validationError);
  }

  let updated: typeof departments.$inferSelect;
  try {
    [updated] = await db
      .update(departments)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.parentDepartmentId !== undefined ? { parentDepartmentId: input.parentDepartmentId } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
        ...(input.assistantManagerId !== undefined ? { assistantManagerId: input.assistantManagerId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(departments.id, departmentId))
      .returning();
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      throw new DepartmentNameConflictError(`Department name "${input.name}" already exists for tenant ${tenantId}`);
    }
    throw err;
  }

  await logTenantConfigAction(db, {
    tenantId,
    superAdminId,
    entityType: "department",
    entityId: departmentId,
    action: "department_edited",
  });

  return toResponseRow(updated);
}
