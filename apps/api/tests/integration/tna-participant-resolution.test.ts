import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { seedTenant, seedRole, assignRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { tnaExercises, tnaExerciseTargets } from "../../src/db/schema/tna-exercises";
import { resolveTnaParticipants } from "../../src/tna/resolve-tna-participants";

/** Direct coverage of `resolveTnaParticipants` — the snapshot resolution run once at Start. Exercised
 * against a real tenant-scoped connection (real RLS) rather than through the full HTTP `/start` route,
 * so each targeting mode and edge case can be asserted precisely against its return shape. */
describe("TNA: participant resolution (resolve-tna-participants.ts)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  async function seedExercise(tenantId: string, targetsAllDepartments = false) {
    return withTenantDb(tenantId, async (db) => {
      const [exercise] = await db
        .insert(tnaExercises)
        .values({ tenantId, title: "Resolution Test", endDate: "2099-12-31", targetsAllDepartments })
        .returning({ id: tnaExercises.id });
      return exercise.id;
    });
  }

  it("department target resolves to manager + assistant manager only, not other members", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);

    const { deptId, managerId, assistantId, otherMemberId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db.insert(users).values({ tenantId, fullName: "Manager", email: `m-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [assistant] = await db.insert(users).values({ tenantId, fullName: "Assistant", email: `a-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id, assistantManagerId: assistant.id })
        .returning({ id: departments.id });
      const [otherMember] = await db
        .insert(users)
        .values({ tenantId, fullName: "Rank and File", email: `r-${randomUUID()}@example.com`, departmentId: dept.id })
        .returning({ id: users.id });
      return { deptId: dept.id, managerId: manager.id, assistantId: assistant.id, otherMemberId: otherMember.id };
    });

    const exerciseId = await seedExercise(tenantId);
    await withTenantDb(tenantId, async (db) => {
      await db.insert(tnaExerciseTargets).values({ tenantId, tnaExerciseId: exerciseId, targetType: "department", departmentId: deptId });
    });

    const result = await withTenantDb(tenantId, (db) => resolveTnaParticipants(db, exerciseId, false));
    const userIds = result.participants.map((p) => p.userId);
    expect(userIds).toEqual(expect.arrayContaining([managerId, assistantId]));
    expect(userIds).not.toContain(otherMemberId);
    expect(result.participants).toHaveLength(2);
    expect(result.departmentsWithNoManager).toEqual([]);
  });

  it("a department with no manager or assistant manager is flagged in departmentsWithNoManager, not silently skipped", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const deptId = await withTenantDb(tenantId, async (db) => {
      const [dept] = await db.insert(departments).values({ tenantId, name: `Empty ${randomUUID()}` }).returning({ id: departments.id });
      return dept.id;
    });

    const exerciseId = await seedExercise(tenantId);
    await withTenantDb(tenantId, async (db) => {
      await db.insert(tnaExerciseTargets).values({ tenantId, tnaExerciseId: exerciseId, targetType: "department", departmentId: deptId });
    });

    const result = await withTenantDb(tenantId, (db) => resolveTnaParticipants(db, exerciseId, false));
    expect(result.participants).toHaveLength(0);
    expect(result.departmentsWithNoManager).toEqual([deptId]);
  });

  it("an archived manager is excluded, and if no active owner remains the department is flagged (gap fix)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { deptId, managerId } = await withTenantDb(tenantId, async (db) => {
      const [manager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Archived Manager", email: `am-${randomUUID()}@example.com`, archivedAt: new Date() })
        .returning({ id: users.id });
      const [dept] = await db
        .insert(departments)
        .values({ tenantId, name: `Dept ${randomUUID()}`, managerId: manager.id })
        .returning({ id: departments.id });
      return { deptId: dept.id, managerId: manager.id };
    });

    const exerciseId = await seedExercise(tenantId);
    await withTenantDb(tenantId, async (db) => {
      await db.insert(tnaExerciseTargets).values({ tenantId, tnaExerciseId: exerciseId, targetType: "department", departmentId: deptId });
    });

    const result = await withTenantDb(tenantId, (db) => resolveTnaParticipants(db, exerciseId, false));
    expect(result.participants.map((p) => p.userId)).not.toContain(managerId);
    expect(result.participants).toHaveLength(0);
    expect(result.departmentsWithNoManager).toEqual([deptId]);
  });

  it("role target resolves every current holder, excluding archived holders", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { activeHolderId, archivedHolderId } = await withTenantDb(tenantId, async (db) => {
      const [active] = await db.insert(users).values({ tenantId, fullName: "Active Holder", email: `h1-${randomUUID()}@example.com` }).returning({ id: users.id });
      const [archived] = await db
        .insert(users)
        .values({ tenantId, fullName: "Archived Holder", email: `h2-${randomUUID()}@example.com`, archivedAt: new Date() })
        .returning({ id: users.id });
      return { activeHolderId: active.id, archivedHolderId: archived.id };
    });
    const { roleId } = await seedRole(tenantId, `Reviewers ${randomUUID()}`);
    await assignRole(tenantId, activeHolderId, roleId);
    await assignRole(tenantId, archivedHolderId, roleId);

    const exerciseId = await seedExercise(tenantId);
    await withTenantDb(tenantId, async (db) => {
      await db.insert(tnaExerciseTargets).values({ tenantId, tnaExerciseId: exerciseId, targetType: "role", roleId });
    });

    const result = await withTenantDb(tenantId, (db) => resolveTnaParticipants(db, exerciseId, false));
    const userIds = result.participants.map((p) => p.userId);
    expect(userIds).toContain(activeHolderId);
    expect(userIds).not.toContain(archivedHolderId);
  });

  it("a directly user-targeted archived user is excluded entirely", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const archivedUserId = await withTenantDb(tenantId, async (db) => {
      const [u] = await db
        .insert(users)
        .values({ tenantId, fullName: "Archived Direct Target", email: `d-${randomUUID()}@example.com`, archivedAt: new Date() })
        .returning({ id: users.id });
      return u.id;
    });

    const exerciseId = await seedExercise(tenantId);
    await withTenantDb(tenantId, async (db) => {
      await db.insert(tnaExerciseTargets).values({ tenantId, tnaExerciseId: exerciseId, targetType: "user", userId: archivedUserId });
    });

    const result = await withTenantDb(tenantId, (db) => resolveTnaParticipants(db, exerciseId, false));
    expect(result.participants).toHaveLength(0);
  });

  it("targetsAllDepartments reaches every active department's owners; dedup keeps one row per (user, department context)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const { sharedManagerId, deptAId, deptBId } = await withTenantDb(tenantId, async (db) => {
      const [sharedManager] = await db
        .insert(users)
        .values({ tenantId, fullName: "Shared Manager", email: `sm-${randomUUID()}@example.com` })
        .returning({ id: users.id });
      const [deptA] = await db
        .insert(departments)
        .values({ tenantId, name: `A ${randomUUID()}`, managerId: sharedManager.id })
        .returning({ id: departments.id });
      const [deptB] = await db
        .insert(departments)
        .values({ tenantId, name: `B ${randomUUID()}`, managerId: sharedManager.id })
        .returning({ id: departments.id });
      return { sharedManagerId: sharedManager.id, deptAId: deptA.id, deptBId: deptB.id };
    });

    const exerciseId = await seedExercise(tenantId, true);
    const result = await withTenantDb(tenantId, (db) => resolveTnaParticipants(db, exerciseId, true));
    // Same person manages two departments — reachable via two distinct department contexts, so gets
    // two separate assignment rows (one per department), not deduped away entirely.
    const forSharedManager = result.participants.filter((p) => p.userId === sharedManagerId);
    expect(forSharedManager).toHaveLength(2);
    expect(forSharedManager.map((p) => p.departmentId).sort()).toEqual([deptAId, deptBId].sort());
  });
});
