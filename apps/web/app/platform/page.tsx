"use client";

// Same minimal design posture as every prior UI surface (constitution Principle V). Client
// component: fetches through next.config.ts's rewrite proxy (relative /platform-api/* path, not
// apps/api's real origin directly) so the session cookie stays same-origin from the browser's
// point of view — see next.config.ts. credentials: "include" is still required even same-origin.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@tm/ui";

const API_BASE = "/platform-api";

interface SuperAdminMe {
  id: string;
  email: string;
  name: string;
  lastLoginAt: string | null;
  isSuperAdminFlagSet: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; data: SuperAdminMe };

export default function PlatformLandingPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/platform/me`, { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthenticated" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as { data: SuperAdminMe };
        setState({ status: "ready", data: json.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/platform/login");
    }
  }, [state.status, router]);

  async function handleLogout() {
    await fetch(`${API_BASE}/platform/logout`, { method: "POST", credentials: "include" });
    router.push("/platform/login");
  }

  if (state.status === "loading" || state.status === "unauthenticated") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-gray-600">Loading…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          Couldn&apos;t load your Super Admin session. Try refreshing.
        </div>
      </main>
    );
  }

  const { data } = state;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        You&apos;re authenticated as a platform Super Admin.
      </div>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">{data.name}</h1>
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Email</dt>
          <dd className="text-right text-gray-900">{data.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Last login</dt>
          <dd className="text-right text-gray-900">{data.lastLoginAt ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Super Admin flag (RLS indicator)</dt>
          <dd className="text-right text-gray-900">{data.isSuperAdminFlagSet ? "Set" : "Not set"}</dd>
        </div>
      </dl>

      <Button variant="outline" className="mt-8" onClick={handleLogout}>
        Log out
      </Button>
    </main>
  );
}
