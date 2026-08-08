import type { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { platformCourses, marketplaceSelections } from "../db/schema/platform-courses";
import { tenants } from "../db/schema/tenants";
import { withTenantConnection } from "../db/with-tenant-connection";
import { listUsersWithPermission } from "../permissions/require-permission";
import { sendCourseUpdateAvailableEmail } from "./course-update-mailer";

/**
 * Course Marketplace Updates (spec 032) — called at the end of every Super Admin authoring route that
 * changes a platform course's content (metadata, curriculum, or files), after that route's own write
 * commits (contracts §Internal, research.md §2/§5/§6).
 *
 * `superAdminDb` (not `fastify.db`) is used throughout, even for `platform_courses` (which carries no
 * RLS at all — either connection would work for that one table) — kept as a single connection for
 * simplicity, and required for `marketplace_selections`/`tenants`, both of which rely on their
 * `super_admin_full_access` RLS policy that only `request.superAdminDb` satisfies (research.md §6,
 * mirroring `admin-marketplace-selection-routes.ts`'s existing cross-tenant reads). `pool` is only
 * needed for the one piece that policy doesn't cover — looking up a specific tenant's
 * `course.manage` holders — via the already-established `withTenantConnection` pattern.
 */
export async function recordPlatformCourseChange(
  superAdminDb: Db,
  pool: Pool,
  platformCourseId: string,
  superAdminId: string,
): Promise<void> {
  const [course] = await superAdminDb
    .update(platformCourses)
    .set({ version: sql`${platformCourses.version} + 1`, updatedBySuperAdminId: superAdminId, updatedAt: new Date() })
    .where(eq(platformCourses.id, platformCourseId))
    .returning();
  if (!course) return;

  const fulfilledSelections = await superAdminDb
    .select()
    .from(marketplaceSelections)
    .where(and(eq(marketplaceSelections.platformCourseId, platformCourseId), eq(marketplaceSelections.status, "fulfilled")));

  for (const selection of fulfilledSelections) {
    // Owed iff there's an unapplied update AND no notification is currently outstanding for it —
    // "outstanding" means the last notification sent was for a version at or before what the tenant
    // has already applied. Comparing against `notifiedPlatformCourseVersion <= appliedPlatformCourseVersion`
    // (not against the new `course.version`) is what makes repeated edits before the tenant reacts
    // collapse into a single email: once notified, `notifiedPlatformCourseVersion` stays above
    // `appliedPlatformCourseVersion` (and therefore "outstanding") through every further edit, until
    // the tenant actually applies or the notified version is otherwise resolved (research.md §5).
    const notificationOwed =
      course.version > selection.appliedPlatformCourseVersion &&
      (selection.notifiedPlatformCourseVersion === null || selection.notifiedPlatformCourseVersion <= selection.appliedPlatformCourseVersion);
    if (!notificationOwed) continue;

    const [tenant] = await superAdminDb.select({ subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, selection.tenantId));
    if (!tenant) continue;

    const rootDomain = process.env.ROOT_DOMAIN ?? "tm.com";
    const manageUrl = `http://${tenant.subdomain}.${rootDomain}/learning/courses/${selection.clonedCourseId}`;

    const recipients = await withTenantConnection(pool, selection.tenantId, (tenantDb) =>
      listUsersWithPermission(tenantDb, "course.manage"),
    );
    for (const recipient of recipients) {
      await sendCourseUpdateAvailableEmail(recipient.email, course.title, manageUrl);
    }

    await superAdminDb
      .update(marketplaceSelections)
      .set({ notifiedPlatformCourseVersion: course.version, updatedAt: new Date() })
      .where(eq(marketplaceSelections.id, selection.id));
  }
}
