import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestServer } from "../helpers/test-server";
import { seedTenant, seedUser, seedUserWithRole, seedRole, assignRole } from "../helpers/fixtures";
import { closeTestPool, withTenantDb } from "../helpers/pg";
import { departments } from "../../src/db/schema/departments";
import { users } from "../../src/db/schema/users";
import { courseAssignments } from "../../src/db/schema/course-assignments";
import { eq } from "drizzle-orm";

type Server = Awaited<ReturnType<typeof buildTestServer>>;
type Headers = Record<string, string>;

async function createCourse(server: Server, headers: Headers, title = `Course ${randomUUID()}`) {
  const response = await server.inject({
    method: "POST",
    url: "/tenant/courses",
    headers,
    payload: { title, category: "Technical", deliveryMode: "virtual", duration: { value: 1, unit: "hours" } },
  });
  return response.json().data as { id: string };
}

async function putAssignments(server: Server, headers: Headers, courseId: string, body: Record<string, unknown>) {
  return server.inject({ method: "PUT", url: `/tenant/courses/${courseId}/assignments`, headers, payload: body });
}

async function getAssignments(server: Server, headers: Headers, courseId: string) {
  return server.inject({ method: "GET", url: `/tenant/courses/${courseId}/assignments`, headers });
}

async function getCourse(server: Server, headers: Headers, courseId: string) {
  return server.inject({ method: "GET", url: `/tenant/courses/${courseId}`, headers });
}

async function seedDepartment(tenantId: string, name: string): Promise<string> {
  return withTenantDb(tenantId, async (db) => {
    const [d] = await db.insert(departments).values({ tenantId, name }).returning({ id: departments.id });
    return d.id;
  });
}

async function seedUserInDepartment(tenantId: string, userId: string, departmentId: string, fullName = "Dept User"): Promise<void> {
  await withTenantDb(tenantId, async (db) => {
    await db.insert(users).values({ id: userId, tenantId, fullName, email: `${userId}@example.com`, departmentId });
  });
}

describe("Course Assignment Deadlines (Course Settings → Assignments)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("organisation ('all') assignment: one shared startsAt, visible via GET assignments and resolved as myStartsAt for any learner once access has started", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    const learnerId = randomUUID();
    await seedUser(tenantId, learnerId);
    await seedUserWithRole(tenantId, learnerId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const learnerHeaders = { "x-test-user-id": learnerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      // A startsAt already in the past — access has begun, so this exercises resolution *and*
      // visibility together without racing the clock.
      const put = await putAssignments(server, adminHeaders, course.id, { mode: "all", allStartsAt: "2020-01-01" });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.allStartsAt).toBe("2020-01-01");
      expect(put.json().data.allCompletionDeadline).toBeNull();

      const get = await getAssignments(server, adminHeaders, course.id);
      expect(get.json().data).toEqual({
        mode: "all",
        allStartsAt: "2020-01-01",
        allCompletionDeadline: null,
        users: [],
        departments: [],
        roles: [],
      });

      const learnerCourse = await getCourse(server, learnerHeaders, course.id);
      expect(learnerCourse.statusCode).toBe(200);
      expect(learnerCourse.json().data.myStartsAt).toBe("2020-01-01");
      expect(learnerCourse.json().data.myCompletionDeadline).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("a startsAt in the future hides the course from a learner until that date arrives — course.manage always bypasses it", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    const learnerId = randomUUID();
    await seedUser(tenantId, learnerId);
    await seedUserWithRole(tenantId, learnerId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const learnerHeaders = { "x-test-user-id": learnerId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      await putAssignments(server, adminHeaders, course.id, { mode: "all", allStartsAt: "2099-01-01" });

      // The learner can't see it in the list or fetch it directly yet.
      const list = await server.inject({ method: "GET", url: "/tenant/courses", headers: learnerHeaders });
      expect((list.json().data as { id: string }[]).some((c) => c.id === course.id)).toBe(false);
      const learnerCourse = await getCourse(server, learnerHeaders, course.id);
      expect(learnerCourse.statusCode).toBe(404);

      // A course.manage caller (the admin) still sees it regardless — the gate only applies to
      // callers without that permission.
      const adminCourse = await getCourse(server, adminHeaders, course.id);
      expect(adminCourse.statusCode).toBe(200);

      // Once the start date has passed, the same learner gets access.
      await putAssignments(server, adminHeaders, course.id, { mode: "all", allStartsAt: "2020-01-01" });
      const learnerCourseAfter = await getCourse(server, learnerHeaders, course.id);
      expect(learnerCourseAfter.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("a user reachable through two paths gets access as soon as either path has started, even if the other hasn't yet", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const engId = await seedDepartment(tenantId, "Engineering");
    const userId = randomUUID();
    await seedUserInDepartment(tenantId, userId, engId, "Multi Path User");

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const learnerHeaders = { "x-test-user-id": userId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      // Department path hasn't started yet; the individual-user path already has.
      await putAssignments(server, adminHeaders, course.id, {
        mode: "selected",
        departments: [{ id: engId, startsAt: "2099-01-01" }],
        users: [{ id: userId, startsAt: "2020-01-01" }],
      });

      const learnerCourse = await getCourse(server, learnerHeaders, course.id);
      expect(learnerCourse.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("?asLearner=true gates a course.manage caller too — Course Settings still sees it, but My Courses/the course player doesn't until the start date", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    // A single account holding course.manage — the common case where whoever configures assignments
    // is also the only user in the tenant, so they can't just switch to a plain-learner account to
    // check what a learner would see.
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);
      await putAssignments(server, adminHeaders, course.id, { mode: "all", allStartsAt: "2099-01-01" });

      // Course Settings / the management editor never sends `asLearner` — course.manage bypasses the
      // date gate there, same as always, so the admin can still configure a course before it starts.
      const managementView = await getCourse(server, adminHeaders, course.id);
      expect(managementView.statusCode).toBe(200);

      // My Courses / the course player sends `asLearner=true` — even this course.manage caller is
      // gated exactly like a learner would be, so they see accurately what a learner sees.
      const learnerView = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}?asLearner=true`, headers: adminHeaders });
      expect(learnerView.statusCode).toBe(404);

      const listAsLearner = await server.inject({ method: "GET", url: "/tenant/courses?asLearner=true", headers: adminHeaders });
      expect((listAsLearner.json().data as { id: string }[]).some((c) => c.id === course.id)).toBe(false);

      // Once the start date has passed, the learner view picks it up too.
      await putAssignments(server, adminHeaders, course.id, { mode: "all", allStartsAt: "2020-01-01" });
      const learnerViewAfter = await server.inject({ method: "GET", url: `/tenant/courses/${course.id}?asLearner=true`, headers: adminHeaders });
      expect(learnerViewAfter.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("organisation ('all') assignment supports startsAt and completionDeadline independently and simultaneously", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    const learnerId = randomUUID();
    await seedUser(tenantId, learnerId);
    await seedUserWithRole(tenantId, learnerId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      const put = await putAssignments(server, adminHeaders, course.id, {
        mode: "all",
        allStartsAt: "2020-01-01",
        allCompletionDeadline: "2026-09-30",
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.allStartsAt).toBe("2020-01-01");
      expect(put.json().data.allCompletionDeadline).toBe("2026-09-30");

      const learnerCourse = await getCourse(server, { "x-test-user-id": learnerId, "x-test-tenant-id": tenantId }, course.id);
      expect(learnerCourse.json().data.myStartsAt).toBe("2020-01-01");
      expect(learnerCourse.json().data.myCompletionDeadline).toBe("2026-09-30");
    } finally {
      await server.close();
    }
  });

  it("department assignment: every member of that department inherits the same dates; different departments can have different dates", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const engId = await seedDepartment(tenantId, "Engineering");
    const salesId = await seedDepartment(tenantId, "Sales");
    const engUserId = randomUUID();
    await seedUserInDepartment(tenantId, engUserId, engId, "Eng User");
    const salesUserId = randomUUID();
    await seedUserInDepartment(tenantId, salesUserId, salesId, "Sales User");

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      const put = await putAssignments(server, adminHeaders, course.id, {
        mode: "selected",
        departments: [
          { id: engId, completionDeadline: "2026-09-30" },
          { id: salesId, completionDeadline: "2026-10-15" },
        ],
      });
      expect(put.statusCode).toBe(200);
      const byId = Object.fromEntries((put.json().data.departments as { id: string; completionDeadline: string }[]).map((d) => [d.id, d.completionDeadline]));
      expect(byId[engId]).toBe("2026-09-30");
      expect(byId[salesId]).toBe("2026-10-15");

      const engCourse = await getCourse(server, { "x-test-user-id": engUserId, "x-test-tenant-id": tenantId }, course.id);
      expect(engCourse.json().data.myCompletionDeadline).toBe("2026-09-30");
      const salesCourse = await getCourse(server, { "x-test-user-id": salesUserId, "x-test-tenant-id": tenantId }, course.id);
      expect(salesCourse.json().data.myCompletionDeadline).toBe("2026-10-15");
    } finally {
      await server.close();
    }
  });

  it("role assignment: every holder of that role inherits the same dates", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const { roleId: managerRoleId } = await seedRole(tenantId, "Manager");
    const managerId = randomUUID();
    await seedUser(tenantId, managerId);
    await assignRole(tenantId, managerId, managerRoleId);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      const put = await putAssignments(server, adminHeaders, course.id, {
        mode: "selected",
        roles: [{ id: managerRoleId, completionDeadline: "2026-10-15" }],
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.roles).toEqual([{ id: managerRoleId, name: "Manager", startsAt: null, completionDeadline: "2026-10-15" }]);

      const managerCourse = await getCourse(server, { "x-test-user-id": managerId, "x-test-tenant-id": tenantId }, course.id);
      expect(managerCourse.json().data.myCompletionDeadline).toBe("2026-10-15");
    } finally {
      await server.close();
    }
  });

  it("individual user assignments: each user has their own independent dates; updating one leaves the others untouched", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const johnId = randomUUID();
    await seedUser(tenantId, johnId, { fullName: "John Smith" });
    const sarahId = randomUUID();
    await seedUser(tenantId, sarahId, { fullName: "Sarah Johnson" });
    const davidId = randomUUID();
    await seedUser(tenantId, davidId, { fullName: "David Williams" });

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      const put = await putAssignments(server, adminHeaders, course.id, {
        mode: "selected",
        users: [
          { id: johnId, completionDeadline: "2026-09-20" },
          { id: sarahId, completionDeadline: "2026-10-05" },
          { id: davidId, completionDeadline: "2026-10-15" },
        ],
      });
      expect(put.statusCode).toBe(200);
      const byId = Object.fromEntries((put.json().data.users as { id: string; completionDeadline: string }[]).map((u) => [u.id, u.completionDeadline]));
      expect(byId).toEqual({ [johnId]: "2026-09-20", [sarahId]: "2026-10-05", [davidId]: "2026-10-15" });

      // Update only John's deadline (full replace-all, but re-sending everyone with just his changed).
      const put2 = await putAssignments(server, adminHeaders, course.id, {
        mode: "selected",
        users: [
          { id: johnId, completionDeadline: "2026-11-01" },
          { id: sarahId, completionDeadline: "2026-10-05" },
          { id: davidId, completionDeadline: "2026-10-15" },
        ],
      });
      const byId2 = Object.fromEntries((put2.json().data.users as { id: string; completionDeadline: string }[]).map((u) => [u.id, u.completionDeadline]));
      expect(byId2).toEqual({ [johnId]: "2026-11-01", [sarahId]: "2026-10-05", [davidId]: "2026-10-15" });

      const johnCourse = await getCourse(server, { "x-test-user-id": johnId, "x-test-tenant-id": tenantId }, course.id);
      expect(johnCourse.json().data.myCompletionDeadline).toBe("2026-11-01");
      const sarahCourse = await getCourse(server, { "x-test-user-id": sarahId, "x-test-tenant-id": tenantId }, course.id);
      expect(sarahCourse.json().data.myCompletionDeadline).toBe("2026-10-05");
    } finally {
      await server.close();
    }
  });

  it("precedence: a user reachable through multiple assignment paths gets the earliest applicable date, per field independently", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const engId = await seedDepartment(tenantId, "Engineering");
    const { roleId: managerRoleId } = await seedRole(tenantId, "Manager");

    // A user in Engineering, holding the Manager role, individually assigned too — three paths, three
    // different completion deadlines (and a starts-at only on the role path).
    const userId = randomUUID();
    await seedUserInDepartment(tenantId, userId, engId, "Multi Path User");
    await assignRole(tenantId, userId, managerRoleId);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      await putAssignments(server, adminHeaders, course.id, {
        mode: "selected",
        departments: [{ id: engId, completionDeadline: "2026-10-15" }],
        roles: [{ id: managerRoleId, startsAt: "2026-08-01", completionDeadline: "2026-10-30" }],
        users: [{ id: userId, completionDeadline: "2026-11-15" }],
      });

      const userCourse = await getCourse(server, { "x-test-user-id": userId, "x-test-tenant-id": tenantId }, course.id);
      // Earliest completionDeadline of {2026-10-15, 2026-10-30, 2026-11-15} is the department's.
      expect(userCourse.json().data.myCompletionDeadline).toBe("2026-10-15");
      // Only the role path sets startsAt — resolved independently of which path won completionDeadline.
      expect(userCourse.json().data.myStartsAt).toBe("2026-08-01");
    } finally {
      await server.close();
    }
  });

  it("a path with no date set doesn't suppress a date from a different applicable path", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const engId = await seedDepartment(tenantId, "Engineering");
    const { roleId: managerRoleId } = await seedRole(tenantId, "Manager");
    const userId = randomUUID();
    await seedUserInDepartment(tenantId, userId, engId, "User");
    await assignRole(tenantId, userId, managerRoleId);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      // Department has no completionDeadline; role does — the role's must still surface.
      await putAssignments(server, adminHeaders, course.id, {
        mode: "selected",
        departments: [{ id: engId, completionDeadline: null }],
        roles: [{ id: managerRoleId, completionDeadline: "2026-10-30" }],
      });

      const userCourse = await getCourse(server, { "x-test-user-id": userId, "x-test-tenant-id": tenantId }, course.id);
      expect(userCourse.json().data.myCompletionDeadline).toBe("2026-10-30");
    } finally {
      await server.close();
    }
  });

  it("admin can change a group's dates; live-resolved reads immediately reflect the new value for every member", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const engId = await seedDepartment(tenantId, "Engineering");
    const userId = randomUUID();
    await seedUserInDepartment(tenantId, userId, engId);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      await putAssignments(server, adminHeaders, course.id, { mode: "selected", departments: [{ id: engId, completionDeadline: "2026-09-30" }] });
      const before = await getCourse(server, { "x-test-user-id": userId, "x-test-tenant-id": tenantId }, course.id);
      expect(before.json().data.myCompletionDeadline).toBe("2026-09-30");

      await putAssignments(server, adminHeaders, course.id, { mode: "selected", departments: [{ id: engId, completionDeadline: "2026-10-15" }] });
      const after = await getCourse(server, { "x-test-user-id": userId, "x-test-tenant-id": tenantId }, course.id);
      expect(after.json().data.myCompletionDeadline).toBe("2026-10-15");
    } finally {
      await server.close();
    }
  });

  it("removing an assignment leaves no orphaned date data — course reverts to 'all', no dates", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    const engId = await seedDepartment(tenantId, "Engineering");

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      await putAssignments(server, adminHeaders, course.id, { mode: "selected", departments: [{ id: engId, completionDeadline: "2026-09-30" }] });
      const revert = await putAssignments(server, adminHeaders, course.id, { mode: "all" });
      expect(revert.statusCode).toBe(200);
      expect(revert.json().data).toEqual({
        mode: "all",
        allStartsAt: null,
        allCompletionDeadline: null,
        users: [],
        departments: [],
        roles: [],
      });

      await withTenantDb(tenantId, async (db) => {
        const rows = await db.select().from(courseAssignments).where(eq(courseAssignments.courseId, course.id));
        expect(rows).toHaveLength(1);
        expect(rows[0].assigneeType).toBe("all");
        expect(rows[0].startsAt).toBeNull();
        expect(rows[0].completionDeadline).toBeNull();
      });
    } finally {
      await server.close();
    }
  });

  it("existing assignments created before this feature (no dates) continue working — myStartsAt/myCompletionDeadline resolve to null, course stays visible", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const learnerId = randomUUID();
    await seedUser(tenantId, learnerId);
    await seedUserWithRole(tenantId, learnerId, ["course.view"]);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);
      // No Settings tab save at all — zero course_assignments rows, exactly like a pre-existing course.

      const learnerCourse = await getCourse(server, { "x-test-user-id": learnerId, "x-test-tenant-id": tenantId }, course.id);
      expect(learnerCourse.statusCode).toBe(200);
      expect(learnerCourse.json().data.myStartsAt).toBeNull();
      expect(learnerCourse.json().data.myCompletionDeadline).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid date format for either field", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      const badFormat = await putAssignments(server, adminHeaders, course.id, { mode: "all", allStartsAt: "09/30/2026" });
      expect(badFormat.statusCode).toBe(400);

      const impossibleDate = await putAssignments(server, adminHeaders, course.id, { mode: "all", allCompletionDeadline: "2026-02-30" });
      expect(impossibleDate.statusCode).toBe(400);

      const missingTargetId = await putAssignments(server, adminHeaders, course.id, { mode: "selected", users: [{ completionDeadline: "2026-09-30" }] });
      expect(missingTargetId.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("allows a past date for either field (no business rule forbids backfilling/correcting one)", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      const put = await putAssignments(server, adminHeaders, course.id, { mode: "all", allStartsAt: "2020-01-01", allCompletionDeadline: "2020-06-01" });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.allStartsAt).toBe("2020-01-01");
      expect(put.json().data.allCompletionDeadline).toBe("2020-06-01");
    } finally {
      await server.close();
    }
  });

  it("returns 403 for a course.view-only caller attempting to set dates", async () => {
    const tenantId = randomUUID();
    await seedTenant(tenantId);
    const adminId = randomUUID();
    await seedUser(tenantId, adminId);
    await seedUserWithRole(tenantId, adminId, ["course.manage"]);
    const viewerId = randomUUID();
    await seedUser(tenantId, viewerId);
    await seedUserWithRole(tenantId, viewerId, ["course.view"]);

    const server = await buildTestServer();
    try {
      const adminHeaders = { "x-test-user-id": adminId, "x-test-tenant-id": tenantId };
      const course = await createCourse(server, adminHeaders);

      const viewerHeaders = { "x-test-user-id": viewerId, "x-test-tenant-id": tenantId };
      const response = await putAssignments(server, viewerHeaders, course.id, { mode: "all", allCompletionDeadline: "2026-09-30" });
      expect(response.statusCode).toBe(403);

      // course.view can still read the dates that are already there.
      const read = await getAssignments(server, viewerHeaders, course.id);
      expect(read.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("does not leak assignment dates or targets across tenants", async () => {
    const tenantAId = randomUUID();
    await seedTenant(tenantAId);
    const adminAId = randomUUID();
    await seedUser(tenantAId, adminAId);
    await seedUserWithRole(tenantAId, adminAId, ["course.manage"]);

    const tenantBId = randomUUID();
    await seedTenant(tenantBId);
    const adminBId = randomUUID();
    await seedUser(tenantBId, adminBId);
    await seedUserWithRole(tenantBId, adminBId, ["course.manage"]);

    const server = await buildTestServer();
    try {
      const adminAHeaders = { "x-test-user-id": adminAId, "x-test-tenant-id": tenantAId };
      const courseA = await createCourse(server, adminAHeaders);
      await putAssignments(server, adminAHeaders, courseA.id, { mode: "all", allCompletionDeadline: "2026-09-30" });

      const adminBHeaders = { "x-test-user-id": adminBId, "x-test-tenant-id": tenantBId };
      // Tenant B's admin can't even see tenant A's course to target its assignments.
      const crossTenantRead = await getAssignments(server, adminBHeaders, courseA.id);
      expect(crossTenantRead.statusCode).toBe(404);
      const crossTenantWrite = await putAssignments(server, adminBHeaders, courseA.id, { mode: "all", allCompletionDeadline: "2099-01-01" });
      expect(crossTenantWrite.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
