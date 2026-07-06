import { headers } from "next/headers";
import DepartmentSettingsClient from "./department-settings-client";

export default async function DepartmentSettingsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <DepartmentSettingsClient subdomain={subdomain} />;
}
