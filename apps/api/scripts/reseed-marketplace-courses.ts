import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import {
  platformCourses,
  platformCourseModules,
  platformCourseContentItems,
  platformFileAttachments,
  marketplaceSelections,
} from "../src/db/schema/platform-courses";
import { superAdmins } from "../src/db/schema/super-admins";

/**
 * Dev-only utility: wipes the platform course catalog (and its dependents — modules, content
 * items, attachments, marketplace_selections) and reseeds it with a fixed set of free demo
 * courses. Cloned tenant courses are never touched — they have no FK back to platform_courses by
 * design (research.md §5), so wiping the catalog doesn't affect any tenant that already selected
 * one. Picks whichever Super Admin account exists first as the author; run
 * `pnpm seed:super-admin` first if none exists yet.
 */
const COURSES = [
  {
    title: "Workplace Safety Fundamentals",
    categoryName: "Compliance",
    deliveryMode: "self_paced",
    duration: { value: 45, unit: "minutes" },
    provider: "TM Learning",
    description: "Core workplace safety practices every employee should know.",
  },
  {
    title: "Preventing Workplace Harassment",
    categoryName: "Compliance",
    deliveryMode: "self_paced",
    duration: { value: 30, unit: "minutes" },
    provider: "TM Learning",
    description: "Recognizing, reporting, and preventing harassment at work.",
  },
  {
    title: "Introduction to Leadership",
    categoryName: "Leadership",
    deliveryMode: "self_paced",
    duration: { value: 90, unit: "minutes" },
    provider: "TM Learning",
    description: "Foundational leadership skills for new and aspiring managers.",
  },
  {
    title: "Giving Effective Feedback",
    categoryName: "Leadership",
    deliveryMode: "self_paced",
    duration: { value: 40, unit: "minutes" },
    provider: "TM Learning",
    description: "How to give feedback that lands and drives real change.",
  },
  {
    title: "Data Privacy Essentials",
    categoryName: "Compliance",
    deliveryMode: "self_paced",
    duration: { value: 35, unit: "minutes" },
    provider: "TM Learning",
    description: "Handling personal data responsibly and staying compliant.",
  },
  {
    title: "Effective Communication Skills",
    categoryName: "Professional Development",
    deliveryMode: "self_paced",
    duration: { value: 50, unit: "minutes" },
    provider: "TM Learning",
    description: "Communicating clearly and confidently across teams.",
  },
  {
    title: "Time Management Essentials",
    categoryName: "Professional Development",
    deliveryMode: "self_paced",
    duration: { value: 40, unit: "minutes" },
    provider: "TM Learning",
    description: "Practical techniques for prioritizing and managing your day.",
  },
  {
    title: "Cybersecurity Awareness",
    categoryName: "Technical",
    deliveryMode: "self_paced",
    duration: { value: 30, unit: "minutes" },
    provider: "TM Learning",
    description: "Spotting phishing, securing accounts, and safe browsing habits.",
  },
  {
    title: "Diversity, Equity & Inclusion Basics",
    categoryName: "Compliance",
    deliveryMode: "self_paced",
    duration: { value: 45, unit: "minutes" },
    provider: "TM Learning",
    description: "Building an inclusive workplace culture.",
  },
  {
    title: "Customer Service Excellence",
    categoryName: "Professional Development",
    deliveryMode: "self_paced",
    duration: { value: 55, unit: "minutes" },
    provider: "TM Learning",
    description: "Delivering service that turns customers into advocates.",
  },
] as const;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    const [admin] = await db.select({ id: superAdmins.id }).from(superAdmins).limit(1);
    if (!admin) {
      throw new Error("No Super Admin account exists — run `pnpm seed:super-admin` first.");
    }

    await db.execute(sql`BEGIN`);

    await db.delete(platformFileAttachments);
    await db.delete(marketplaceSelections);
    await db.delete(platformCourseContentItems);
    await db.delete(platformCourseModules);
    await db.delete(platformCourses);

    for (const c of COURSES) {
      const [course] = await db
        .insert(platformCourses)
        .values({
          title: c.title,
          description: c.description,
          categoryName: c.categoryName,
          deliveryMode: c.deliveryMode,
          durationValue: c.duration.value,
          durationUnit: c.duration.unit,
          provider: c.provider,
          cost: null,
          status: "active",
          createdBySuperAdminId: admin.id,
          updatedBySuperAdminId: admin.id,
        })
        .returning();

      const [module1] = await db
        .insert(platformCourseModules)
        .values({
          platformCourseId: course.id,
          title: "Getting Started",
          description: "An introduction to the topic.",
          position: 0,
          createdBySuperAdminId: admin.id,
          updatedBySuperAdminId: admin.id,
        })
        .returning();

      await db.insert(platformCourseContentItems).values([
        {
          platformCourseId: course.id,
          platformCourseModuleId: module1.id,
          type: "video",
          title: "Welcome and Overview",
          description: null,
          position: 0,
          payload: { url: "https://example.com/videos/welcome.mp4" },
          createdBySuperAdminId: admin.id,
          updatedBySuperAdminId: admin.id,
        },
        {
          platformCourseId: course.id,
          platformCourseModuleId: module1.id,
          type: "article",
          title: "Key Concepts",
          description: null,
          position: 1,
          payload: { body: `An overview of the core ideas behind ${c.title.toLowerCase()}.` },
          createdBySuperAdminId: admin.id,
          updatedBySuperAdminId: admin.id,
        },
      ]);

      const [module2] = await db
        .insert(platformCourseModules)
        .values({
          platformCourseId: course.id,
          title: "Applying What You've Learned",
          description: "Putting the concepts into practice.",
          position: 1,
          createdBySuperAdminId: admin.id,
          updatedBySuperAdminId: admin.id,
        })
        .returning();

      await db.insert(platformCourseContentItems).values([
        {
          platformCourseId: course.id,
          platformCourseModuleId: module2.id,
          type: "test",
          title: "Knowledge Check",
          description: null,
          position: 0,
          payload: {},
          createdBySuperAdminId: admin.id,
          updatedBySuperAdminId: admin.id,
        },
      ]);

      console.log(`Created: ${c.title} (${course.id})`);
    }

    await db.execute(sql`COMMIT`);
    console.log(`\nDone — ${COURSES.length} free platform courses seeded.`);
  } catch (err) {
    await db.execute(sql`ROLLBACK`);
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
