import { headers } from "next/headers";
import { notFound } from "next/navigation";

const MESSAGES: Record<string, { heading: string; body: string }> = {
  suspended: {
    heading: "This account is suspended",
    body: "Contact your account representative to reactivate this workspace.",
  },
  cancelled: {
    heading: "This account is cancelled",
    body: "Contact sales if you'd like to reinstate this workspace.",
  },
};

// middleware.ts's rewrite target for suspended/cancelled tenant subdomains (spec 004 FR-008, US4).
// A distinct, status-specific page — never a generic 404, never a login form. Same minimal design
// posture as every prior UI surface (constitution Principle V).
export default async function TenantStatusPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const copy = MESSAGES[state];
  if (!copy) {
    notFound();
  }

  const headerList = await headers();
  const tenantName = headerList.get("x-tenant-name");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">{copy.heading}</h1>
      {tenantName && <p className="mt-1 text-sm text-gray-500">{tenantName}</p>}
      <p className="mt-2 text-sm text-gray-600">{copy.body}</p>
    </main>
  );
}
