import { eq, inArray, isNotNull, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { departments } from "../db/schema/departments";
import { users } from "../db/schema/users";
import { tenants } from "../db/schema/tenants";
import { TenantNotFoundError } from "./errors";

export interface TenantDepartmentRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  parentDepartmentId: string | null;
  memberCount: number;
  hasChildren: boolean;
  manager: { id: string; fullName: string } | null;
  assistantManager: { id: string; fullName: string } | null;
}

/**
 * contracts/super-admin-tenant-console-api.md `GET /tenants/:id/departments` (spec FR-004). `db`
 * must be `request.superAdminDb`. Deliberately does NOT reuse `department-hierarchy.ts`'s helpers or
 * `tenant-department-routes.ts`'s own query body — those rely on `request.tenantDb`'s ambient RLS
 * scoping (no `tenant_id` filter in their own queries), which does not hold for this connection
 * (research.md §1). Every query here explicitly filters by `tenant_id = params.tenantId`.
 */
export async function getTenantDepartments(
  db: Db,
  params: { tenantId: string },
): Promise<TenantDepartmentRow[]> {
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, params.tenantId));
  if (!tenant) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }

  const all = await db.select().from(departments).where(eq(departments.tenantId, params.tenantId));

  const memberCounts = await db
    .select({ departmentId: users.departmentId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.tenantId, params.tenantId), isNotNull(users.departmentId)))
    .groupBy(users.departmentId);
  const memberCountByDept = new Map(memberCounts.map((row) => [row.departmentId, row.count]));

  const parentIds = new Set(all.map((d) => d.parentDepartmentId).filter((id): id is string => !!id));

  const userIds = Array.from(
    new Set(all.flatMap((d) => [d.managerId, d.assistantManagerId]).filter((id): id is string => !!id)),
  );
  const userRows =
    userIds.length > 0
      ? await db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(and(eq(users.tenantId, params.tenantId), inArray(users.id, userIds)))
      : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  return all.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    status: d.status,
    parentDepartmentId: d.parentDepartmentId,
    memberCount: memberCountByDept.get(d.id) ?? 0,
    hasChildren: parentIds.has(d.id),
    manager: d.managerId ? (userById.get(d.managerId) ?? null) : null,
    assistantManager: d.assistantManagerId ? (userById.get(d.assistantManagerId) ?? null) : null,
  }));
}
