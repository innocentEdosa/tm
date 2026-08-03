import { headers } from "next/headers";
import CourseMarketplaceClient from "./course-marketplace-client";

export default async function CourseMarketplacePage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <CourseMarketplaceClient subdomain={subdomain} />;
}
