import type { FastifyPluginAsync } from "fastify";
import { eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { requireTenantUserSession } from "../tenant-auth/require-tenant-user-session";
import { requireAnyPermission } from "../permissions/require-permission";
import { departments } from "../db/schema/departments";
import { users } from "../db/schema/users";
import {
  findAncestorChain,
  hasChildren as hasChildDepartments,
  subtreeMemberCount,
} from "./department-hierarchy";
import { getFormFields } from "../custom-fields/field-key-uniqueness";
import { validateCustomFieldValues, writeCustomFieldValues } from "../custom-fields/save-values";

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

type DepartmentRow = typeof departments.$inferSelect;

/** contracts/department-management-api.md. All routes operate through `request.tenantDb`
 * (RLS-scoped) — no route ever takes or trusts a client-supplied tenant id. */
const tenantDepartmentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tenant/departments — spec FR-001/FR-014/FR-015, contracts/department-management-api.md.
  // Also readable by `course.manage` (Course Assignment Settings) — it needs the department list to
  // populate the course-assignment picker, not to manage departments themselves.
  fastify.get<{ Querystring: { search?: string } }>(
    "/tenant/departments",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("department.view", "course.manage")] },
    async (request) => {
      const all = await request.tenantDb.select().from(departments);

      const memberCounts = await request.tenantDb
        .select({ departmentId: users.departmentId, count: sql<number>`count(*)::int` })
        .from(users)
        .where(isNotNull(users.departmentId))
        .groupBy(users.departmentId);
      const memberCountByDept = new Map(memberCounts.map((row) => [row.departmentId, row.count]));

      const parentIds = new Set(all.map((d) => d.parentDepartmentId).filter((id): id is string => !!id));

      const userIds = Array.from(
        new Set(
          all.flatMap((d) => [d.managerId, d.assistantManagerId]).filter((id): id is string => !!id),
        ),
      );
      const userRows =
        userIds.length > 0
          ? await request.tenantDb
              .select({ id: users.id, fullName: users.fullName })
              .from(users)
              .where(inArray(users.id, userIds))
          : [];
      const userById = new Map(userRows.map((u) => [u.id, u]));

      const search = request.query.search?.trim().toLowerCase();
      let visibleIds: Set<string> | null = null;
      if (search) {
        const byId = new Map(all.map((d) => [d.id, d]));
        const matched = all.filter((d) => d.name.toLowerCase().includes(search));
        const withAncestors = new Set<string>();
        for (const dept of matched) {
          let current: DepartmentRow | undefined = dept;
          while (current) {
            withAncestors.add(current.id);
            current = current.parentDepartmentId ? byId.get(current.parentDepartmentId) : undefined;
          }
        }
        visibleIds = withAncestors;
      }

      const data = all
        .filter((d) => !visibleIds || visibleIds.has(d.id))
        .map((d) => ({
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

      return { success: true, data };
    },
  );

  // GET /tenant/users?search= — research.md §10. Exists solely to back the Manager/Assistant
  // Manager pickers, needed whenever creating or editing a department — gated by the legacy
  // superset or either of the two granular keys that actually use it (Granular Permissions
  // addendum), not a general user-directory permission. Also readable by `course.manage`, which
  // needs the same search to back the course-assignment picker's user target.
  fastify.get<{ Querystring: { search?: string } }>(
    "/tenant/users",
    {
      preHandler: [
        requireTenantUserSession(),
        requireAnyPermission("department.manage", "department.create", "department.edit", "course.manage"),
      ],
    },
    async (request, reply) => {
      const search = request.query.search?.trim();
      if (!search) {
        return reply.code(400).send({ success: false, message: "search is required" });
      }
      const pattern = `%${search}%`;
      const rows = await request.tenantDb
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(or(sql`${users.fullName} ILIKE ${pattern}`, sql`${users.email} ILIKE ${pattern}`));

      return { success: true, data: rows };
    },
  );

  interface DepartmentWriteBody {
    name?: string;
    parentDepartmentId?: string | null;
    description?: string;
    status?: "active" | "archived";
    managerId?: string | null;
    assistantManagerId?: string | null;
    customFieldValues?: Record<string, unknown>;
  }

  /** Shared by POST/PATCH — spec FR-004/FR-005/FR-006/FR-019/FR-020, contracts §POST/§PATCH.
   * `currentId` is the department being saved (undefined on create, so the cycle check is
   * trivially satisfied since a brand-new row has no descendants yet). */
  async function validateHierarchyAndManagers(
    tenantDb: typeof fastify.db,
    body: DepartmentWriteBody,
    currentId: string | undefined,
  ): Promise<{ error: { code: number; message: string } } | { error: null }> {
    if (body.parentDepartmentId) {
      const chain = await findAncestorChain(tenantDb, body.parentDepartmentId);
      if (chain.length === 0) {
        return { error: { code: 422, message: "Parent department not found" } };
      }
      if (currentId && chain.includes(currentId)) {
        return {
          error: { code: 422, message: "Cannot set a department as its own parent or descendant" },
        };
      }
      if (chain.length >= 3) {
        return { error: { code: 422, message: "Departments can only be nested up to 3 levels deep" } };
      }
    }

    const managerId = body.managerId ?? undefined;
    const assistantManagerId = body.assistantManagerId ?? undefined;
    if (managerId && managerId === assistantManagerId) {
      return { error: { code: 422, message: "Manager and Assistant Manager must be different people" } };
    }
    for (const userId of [managerId, assistantManagerId]) {
      if (!userId) continue;
      const [found] = await tenantDb.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!found) {
        return { error: { code: 422, message: "Manager/Assistant Manager user not found" } };
      }
    }

    return { error: null };
  }

  function toResponseRow(
    d: DepartmentRow,
    extra: { memberCount: number; hasChildren: boolean; manager: unknown; assistantManager: unknown },
  ) {
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      status: d.status,
      parentDepartmentId: d.parentDepartmentId,
      ...extra,
    };
  }

  // POST /tenant/departments — spec FR-002/FR-004-FR-007/FR-019/FR-020.
  fastify.post<{ Body: DepartmentWriteBody }>(
    "/tenant/departments",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("department.manage", "department.create")] },
    async (request, reply) => {
      const { name, parentDepartmentId, description, managerId, assistantManagerId } =
        request.body ?? {};
      if (!name || !name.trim()) {
        return reply.code(400).send({ success: false, message: "name is required" });
      }

      const validation = await validateHierarchyAndManagers(request.tenantDb, request.body, undefined);
      if (validation.error) {
        return reply.code(validation.error.code).send({ success: false, message: validation.error.message });
      }

      // spec FR-015/research.md §5 — validated *before* the department insert, since
      // tenant-context.ts commits the whole per-request transaction on `onResponse` regardless of
      // status code: a 422 returned after the insert would still commit it.
      const customFieldValues = request.body.customFieldValues;
      const fields = customFieldValues ? await getFormFields(request.tenantDb, "department") : [];
      if (customFieldValues) {
        const errors = validateCustomFieldValues(customFieldValues, fields);
        if (errors.length > 0) {
          return reply.code(422).send({ success: false, errors });
        }
      }

      let created: DepartmentRow;
      try {
        [created] = await request.tenantDb
          .insert(departments)
          .values({
            tenantId: request.user!.tenantId,
            name: name.trim(),
            parentDepartmentId: parentDepartmentId ?? null,
            description: description ?? null,
            managerId: managerId ?? null,
            assistantManagerId: assistantManagerId ?? null,
            status: "active",
          })
          .returning();
      } catch (err) {
        if (pgErrorCode(err) === "23505") {
          return reply.code(409).send({ success: false, message: "A department with this name already exists" });
        }
        throw err;
      }

      if (customFieldValues) {
        await writeCustomFieldValues(
          request.tenantDb,
          request.user!.tenantId,
          "department",
          created.id,
          customFieldValues,
          fields,
        );
      }

      return reply.code(201).send({
        success: true,
        data: toResponseRow(created, { memberCount: 0, hasChildren: false, manager: null, assistantManager: null }),
      });
    },
  );

  // PATCH /tenant/departments/:departmentId — spec FR-003/FR-004-FR-007/FR-009/FR-019/FR-020.
  fastify.patch<{ Params: { departmentId: string }; Body: DepartmentWriteBody }>(
    "/tenant/departments/:departmentId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("department.manage", "department.edit")] },
    async (request, reply) => {
      const { departmentId } = request.params;
      const [existing] = await request.tenantDb
        .select()
        .from(departments)
        .where(eq(departments.id, departmentId));
      if (!existing) {
        return reply.code(404).send({ success: false, message: "Not found" });
      }

      const body = request.body ?? {};
      const validation = await validateHierarchyAndManagers(request.tenantDb, body, departmentId);
      if (validation.error) {
        return reply.code(validation.error.code).send({ success: false, message: validation.error.message });
      }

      // spec FR-015/research.md §5 — validated before the update, same reasoning as POST above.
      const customFieldValues = body.customFieldValues;
      const fields = customFieldValues ? await getFormFields(request.tenantDb, "department") : [];
      if (customFieldValues) {
        const errors = validateCustomFieldValues(customFieldValues, fields);
        if (errors.length > 0) {
          return reply.code(422).send({ success: false, errors });
        }
      }

      let updated: DepartmentRow;
      try {
        [updated] = await request.tenantDb
          .update(departments)
          .set({
            ...(body.name !== undefined ? { name: body.name.trim() } : {}),
            ...(body.parentDepartmentId !== undefined ? { parentDepartmentId: body.parentDepartmentId } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.managerId !== undefined ? { managerId: body.managerId } : {}),
            ...(body.assistantManagerId !== undefined ? { assistantManagerId: body.assistantManagerId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(departments.id, departmentId))
          .returning();
      } catch (err) {
        if (pgErrorCode(err) === "23505") {
          return reply.code(409).send({ success: false, message: "A department with this name already exists" });
        }
        throw err;
      }

      if (customFieldValues) {
        await writeCustomFieldValues(
          request.tenantDb,
          request.user!.tenantId,
          "department",
          departmentId,
          customFieldValues,
          fields,
        );
      }

      const memberCount = await request.tenantDb
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.departmentId, departmentId));
      const childExists = await hasChildDepartments(request.tenantDb, departmentId);

      return reply.code(200).send({
        success: true,
        data: toResponseRow(updated, {
          memberCount: memberCount[0]?.count ?? 0,
          hasChildren: childExists,
          manager: null,
          assistantManager: null,
        }),
      });
    },
  );

  // DELETE /tenant/departments/:departmentId — spec FR-008/FR-016/FR-021.
  fastify.delete<{ Params: { departmentId: string } }>(
    "/tenant/departments/:departmentId",
    { preHandler: [requireTenantUserSession(), requireAnyPermission("department.manage", "department.delete")] },
    async (request, reply) => {
      const { departmentId } = request.params;

      const memberCount = await subtreeMemberCount(request.tenantDb, departmentId);
      if (memberCount > 0) {
        return reply.code(409).send({
          success: false,
          reason: "has_members",
          memberCount,
          message: `This department has ${memberCount} member(s). Reassign them before deleting.`,
          membersListHref: `/settings/team?department=${departmentId}`,
        });
      }

      const childExists = await hasChildDepartments(request.tenantDb, departmentId);
      if (childExists) {
        return reply.code(409).send({
          success: false,
          reason: "has_children",
          message: "This department has sub-departments. Delete or move them first.",
        });
      }

      await request.tenantDb.delete(departments).where(eq(departments.id, departmentId));
      return reply.code(200).send({ success: true });
    },
  );
};

export default tenantDepartmentRoutes;
