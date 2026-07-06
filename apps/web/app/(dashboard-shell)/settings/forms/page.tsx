import { headers } from "next/headers";
import FormsSettingsClient from "./forms-settings-client";

export default async function FormsSettingsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <FormsSettingsClient subdomain={subdomain} />;
}
