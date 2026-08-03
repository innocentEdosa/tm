import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { platformCourseModules, platformCourseContentItems } from "../db/schema/platform-courses";

/** Shared by the Super Admin detail read (platform-course-routes.ts) and the tenant marketplace
 * detail read (course-marketplace/tenant-marketplace-routes.ts) — same curriculum-outline shape as
 * spec 024's tenant `GET .../curriculum` (contracts/course-marketplace-api.md). */
export async function getPlatformCourseCurriculum(db: Db, platformCourseId: string) {
  const moduleRows = await db
    .select()
    .from(platformCourseModules)
    .where(eq(platformCourseModules.platformCourseId, platformCourseId))
    .orderBy(platformCourseModules.position);

  const itemRows = await db
    .select()
    .from(platformCourseContentItems)
    .where(eq(platformCourseContentItems.platformCourseId, platformCourseId))
    .orderBy(platformCourseContentItems.position);

  const itemsByModule = new Map<string, (typeof itemRows)[number][]>();
  for (const item of itemRows) {
    const list = itemsByModule.get(item.platformCourseModuleId) ?? [];
    list.push(item);
    itemsByModule.set(item.platformCourseModuleId, list);
  }

  return moduleRows.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    contentItems: (itemsByModule.get(m.id) ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      title: c.title,
      description: c.description,
      payload: c.payload,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  }));
}
