import { headers } from "next/headers";
import AiActivityClient from "./ai-activity-client";

export default async function AiActivityPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <AiActivityClient subdomain={subdomain} />;
}
