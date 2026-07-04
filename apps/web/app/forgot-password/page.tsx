import { headers } from "next/headers";
import ForgotPasswordForm from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  return <ForgotPasswordForm subdomain={subdomain} />;
}
