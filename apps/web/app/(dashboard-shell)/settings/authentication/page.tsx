import { headers } from "next/headers";
import AuthenticationSettingsClient from "./authentication-settings-client";

export default async function AuthenticationSettingsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <AuthenticationSettingsClient subdomain={subdomain} />;
}
