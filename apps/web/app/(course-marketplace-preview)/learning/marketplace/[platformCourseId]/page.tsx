import { headers } from "next/headers";
import CourseMarketplaceDetailClient from "./course-marketplace-detail-client";

export default async function CourseMarketplaceDetailPage({
  params,
}: {
  params: Promise<{ platformCourseId: string }>;
}) {
  const { platformCourseId } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <CourseMarketplaceDetailClient subdomain={subdomain} platformCourseId={platformCourseId} />;
}
