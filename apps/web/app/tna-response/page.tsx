import { headers } from "next/headers";
import TnaResponseForm from "./tna-response-form";

export default async function TnaResponsePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const { token } = await searchParams;
  return <TnaResponseForm subdomain={subdomain} token={token ?? ""} />;
}
