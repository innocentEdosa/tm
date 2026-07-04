import { headers } from "next/headers";
import ResetPasswordForm from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const { token } = await searchParams;
  return <ResetPasswordForm subdomain={subdomain} token={token ?? ""} />;
}
