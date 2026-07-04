import { headers } from "next/headers";
import TeamSettingsClient from "./team-settings-client";

export default async function TeamSettingsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <TeamSettingsClient subdomain={subdomain} />;
}
