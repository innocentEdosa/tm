import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import SetPasswordForm from "./set-password-form";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

export default async function SetPasswordPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("tm_tenant_session");

  if (!sessionCookie) {
    redirect("/tenant");
  }

  const meRes = await fetch(`${API_ORIGIN}/tenant-auth/me?subdomain=${encodeURIComponent(subdomain)}`, {
    headers: { cookie: `tm_tenant_session=${sessionCookie.value}` },
    cache: "no-store",
  });
  if (!meRes.ok) {
    redirect("/tenant");
  }

  return <SetPasswordForm subdomain={subdomain} />;
}
