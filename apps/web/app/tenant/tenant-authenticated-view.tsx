"use client";

import { useRouter } from "next/navigation";
import { Button } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

// Minimal authenticated confirmation (spec Assumptions) — no full product dashboard, which
// remains out of scope for this feature.
export default function TenantAuthenticatedView({
  email,
  subdomain,
}: {
  email: string;
  subdomain: string;
}) {
  const router = useRouter();

  async function handleLogout() {
    await fetch(`${API_BASE}/logout?subdomain=${encodeURIComponent(subdomain)}`, {
      method: "POST",
      credentials: "include",
    });
    router.push("/tenant");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
      <div className="banner-success">You&apos;re signed in as {email}.</div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-primary">
        Your workspace is ready.
      </h1>
      <Button variant="outline" className="mt-8" onClick={handleLogout}>
        Log out
      </Button>
    </main>
  );
}
