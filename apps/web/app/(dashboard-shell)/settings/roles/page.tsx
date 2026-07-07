import { headers } from "next/headers";
import RolesSettingsClient from "./roles-settings-client";

export default async function RolesSettingsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <RolesSettingsClient subdomain={subdomain} />;
}
