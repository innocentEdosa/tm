import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema/users";
import { userRoles, roles } from "../db/schema/roles";
import { departments } from "../db/schema/departments";
import { tenants } from "../db/schema/tenants";
import { TenantNotFoundError } from "./errors";

export interface TenantMemberRow {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  departmentName: string | null;
  accountStatus: "invited" | "active";
}

export interface TenantMembersResult {
  data: TenantMemberRow[];
  meta: { page: number; pageSize: number; total: number };
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * contracts/super-admin-tenant-console-api.md `GET /tenants/:id/members` (spec FR-006). `db` must be
 * `request.superAdminDb`. Same response shape as the existing `GET /tenant/team` (minus invite
 * metadata, not needed by this console), but every query explicitly filters by
 * `users.tenant_id = params.tenantId` (research.md §1) rather than relying on `request.tenantDb`'s
 * ambient RLS scoping — and unlike that route, applies no `team.view.department` visibility
 * narrowing: a Super Admin always sees every member of the tenant.
 */
export async function getTenantMembers(
  db: Db,
  params: { tenantId: string; search?: string; page?: number; pageSize?: number },
): Promise<TenantMembersResult> {
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, params.tenantId));
  if (!tenant) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }

  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : DEFAULT_PAGE_SIZE;

  const conditions = [eq(users.tenantId, params.tenantId)];
  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(or(ilike(users.fullName, term), ilike(users.email, term))!);
  }

  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(...conditions));

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      mustChangePassword: users.mustChangePassword,
      departmentName: departments.name,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(...conditions))
    .orderBy(users.fullName)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data: TenantMemberRow[] = rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    roleName: row.roleName,
    departmentName: row.departmentName,
    accountStatus: row.mustChangePassword ? "invited" : "active",
  }));

  return { data, meta: { page, pageSize, total } };
}
