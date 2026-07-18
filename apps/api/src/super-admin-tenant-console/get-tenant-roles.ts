import { eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { roles, rolePermissions } from "../db/schema/roles";
import { permissions } from "../db/schema/permissions";
import { tenants } from "../db/schema/tenants";
import { getRoleMemberCounts } from "../permissions/role-member-counts";
import { TenantNotFoundError } from "./errors";

export interface TenantRoleRow {
  id: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  isSystem: boolean;
  memberCount: number;
}

/**
 * contracts/super-admin-tenant-console-api.md `GET /tenants/:id/roles` (spec FR-005). `db` must be
 * `request.superAdminDb`. `roles`/`role_permissions` are queried with an explicit
 * `tenant_id = params.tenantId` filter (research.md §1) — strictly excludes the platform-level
 * `tenant_id IS NULL` Super Admin role. `getRoleMemberCounts` (existing helper) IS safely reusable
 * unmodified here: it groups by `role_id`, a value already unique per tenant by construction, so
 * intersecting its result only against this tenant's own role ids (done below) never leaks another
 * tenant's counts (research.md §2).
 */
export async function getTenantRoles(db: Db, params: { tenantId: string }): Promise<TenantRoleRow[]> {
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, params.tenantId));
  if (!tenant) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }

  const tenantRoles = await db.select().from(roles).where(eq(roles.tenantId, params.tenantId));

  const roleIds = tenantRoles.map((r) => r.id);
  const rolePerms =
    roleIds.length > 0
      ? await db
          .select({ roleId: rolePermissions.roleId, key: permissions.key })
          .from(rolePermissions)
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(inArray(rolePermissions.roleId, roleIds))
      : [];
  const keysByRole = new Map<string, string[]>();
  for (const row of rolePerms) {
    const list = keysByRole.get(row.roleId) ?? [];
    list.push(row.key);
    keysByRole.set(row.roleId, list);
  }

  const memberCounts = await getRoleMemberCounts(db);

  return tenantRoles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissionKeys: keysByRole.get(role.id) ?? [],
    isSystem: role.sourceTemplateId !== null,
    memberCount: memberCounts.get(role.id) ?? 0,
  }));
}

export interface PermissionCatalogEntry {
  key: string;
  displayName: string;
  description: string;
  category: string;
}

/**
 * Super Admin Edit Tenant Configuration spec (022), research.md §4 — backs the console's Roles tab
 * permission-key picker. Reuses the exact same tenant-facing filter
 * `GET /tenant/permission-catalog` already applies (`category != 'platform'`); not tenant-scoped
 * by `:id` beyond routing convention, since `permissions` carries no `tenant_id` and no RLS at all —
 * every tenant sees the identical catalog.
 */
export async function getPermissionCatalog(db: Db): Promise<PermissionCatalogEntry[]> {
  const rows = await db
    .select({
      key: permissions.key,
      displayName: permissions.displayName,
      description: permissions.description,
      category: permissions.category,
    })
    .from(permissions)
    .where(ne(permissions.category, "platform"));
  return rows;
}
