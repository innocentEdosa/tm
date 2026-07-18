import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { roles, rolePermissions } from "../db/schema/roles";
import { permissions } from "../db/schema/permissions";
import { getRoleMemberCounts } from "../permissions/role-member-counts";
import { logTenantConfigAction } from "./tenant-config-action-log";
import { RecordNotFoundError, SystemRoleError, RoleInUseError, RoleNameConflictError } from "./errors";

export interface CreateTenantRoleInput {
  name: string;
  description?: string;
  permissionKeys?: string[];
}

export interface EditTenantRoleInput {
  name?: string;
  description?: string;
  permissionKeys?: string[];
}

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/**
 * research.md §4 — resolves permission keys against the same tenant-facing catalog
 * `GET /tenant/permission-catalog` already exposes (`category != 'platform'`), so a
 * `platform`-category key is silently dropped here exactly as it already is on the tenant side
 * (`inArray(permissions.key, permissionKeys)` only ever matches rows actually returned by this
 * query).
 */
async function resolveAssignablePermissionIds(db: Db, permissionKeys: string[]): Promise<string[]> {
  if (permissionKeys.length === 0) return [];
  const perms = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(and(inArray(permissions.key, permissionKeys), ne(permissions.category, "platform")));
  return perms.map((p) => p.id);
}

async function currentPermissionKeys(db: Db, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.key);
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `POST /tenants/:id/roles` (spec FR-004). `db`
 * must be `request.superAdminDb`. Mirrors `POST /tenant/roles`'s (Spec 011) exact shape, explicitly
 * scoped to `tenantId` (research.md §1) and logging to `tenant_config_action_log` (research.md §3).
 */
export async function createTenantRole(
  db: Db,
  params: { tenantId: string; superAdminId: string; input: CreateTenantRoleInput },
): Promise<{ id: string; name: string; permissionKeys: string[] }> {
  const { tenantId, superAdminId, input } = params;

  let createdRoleId: string;
  try {
    const [created] = await db
      .insert(roles)
      .values({ tenantId, name: input.name, description: input.description })
      .returning({ id: roles.id });
    createdRoleId = created.id;
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      throw new RoleNameConflictError(`Role name "${input.name}" already exists for tenant ${tenantId}`);
    }
    throw err;
  }

  const permissionIds = await resolveAssignablePermissionIds(db, input.permissionKeys ?? []);
  if (permissionIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionIds.map((permissionId) => ({ roleId: createdRoleId, permissionId })));
  }

  await logTenantConfigAction(db, {
    tenantId,
    superAdminId,
    entityType: "role",
    entityId: createdRoleId,
    action: "role_created",
  });

  return {
    id: createdRoleId,
    name: input.name,
    permissionKeys: await currentPermissionKeys(db, createdRoleId),
  };
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `PATCH /tenants/:id/roles/:roleId` (spec FR-004).
 * Mirrors `PATCH /tenant/roles/:roleId`'s (Spec 011) exact shape, including the system-role guard
 * (spec FR-005), explicitly scoped to `tenantId`.
 */
export async function editTenantRole(
  db: Db,
  params: { tenantId: string; roleId: string; superAdminId: string; input: EditTenantRoleInput },
): Promise<{ id: string; name: string; permissionKeys: string[] }> {
  const { tenantId, roleId, superAdminId, input } = params;

  const [existing] = await db
    .select({ id: roles.id, name: roles.name, sourceTemplateId: roles.sourceTemplateId })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
  if (!existing) {
    throw new RecordNotFoundError(`No role ${roleId} for tenant ${tenantId}`);
  }
  if (existing.sourceTemplateId !== null) {
    throw new SystemRoleError("System roles cannot be modified.");
  }

  if (input.name !== undefined || input.description !== undefined) {
    try {
      await db
        .update(roles)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: new Date(),
        })
        .where(eq(roles.id, roleId));
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        throw new RoleNameConflictError(`Role name "${input.name}" already exists for tenant ${tenantId}`);
      }
      throw err;
    }
  }

  if (input.permissionKeys !== undefined) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    const permissionIds = await resolveAssignablePermissionIds(db, input.permissionKeys);
    if (permissionIds.length > 0) {
      await db
        .insert(rolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
    }
  }

  await logTenantConfigAction(db, {
    tenantId,
    superAdminId,
    entityType: "role",
    entityId: roleId,
    action: "role_edited",
  });

  const [updated] = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.id, roleId));
  return {
    id: updated.id,
    name: updated.name,
    permissionKeys: await currentPermissionKeys(db, roleId),
  };
}

/**
 * contracts/super-admin-edit-tenant-config-api.md `DELETE /tenants/:id/roles/:roleId` (spec
 * FR-004/FR-005). Mirrors `DELETE /tenant/roles/:roleId`'s (Spec 011) exact shape — the system-role
 * check runs before the member-assignment check (research.md's own `tenant-role-routes.ts` comment:
 * a system role with zero members still correctly reports "cannot be modified," not a silent
 * success).
 */
export async function deleteTenantRole(
  db: Db,
  params: { tenantId: string; roleId: string; superAdminId: string },
): Promise<void> {
  const { tenantId, roleId, superAdminId } = params;

  const [existing] = await db
    .select({ id: roles.id, sourceTemplateId: roles.sourceTemplateId })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
  if (!existing) {
    throw new RecordNotFoundError(`No role ${roleId} for tenant ${tenantId}`);
  }
  if (existing.sourceTemplateId !== null) {
    throw new SystemRoleError("System roles cannot be modified.");
  }

  try {
    await db.delete(roles).where(eq(roles.id, roleId));
  } catch (err) {
    if (pgErrorCode(err) === "23503") {
      throw new RoleInUseError("Role has users assigned; reassign them before deleting.");
    }
    throw err;
  }

  await logTenantConfigAction(db, {
    tenantId,
    superAdminId,
    entityType: "role",
    entityId: roleId,
    action: "role_deleted",
  });
}
