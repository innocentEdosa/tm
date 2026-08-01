"use client";

// Follows the existing minimal, nascent conventions (Tailwind v4, @tm/ui palette/tokens) pending a
// fully locked design system — constitution Principle V, matching every prior UI surface in this
// codebase. Not linked from, or reachable via, any tenant-facing page (spec FR-004).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@tm/ui";

// Relative, not an absolute apps/api URL: requests go through next.config.ts's rewrite proxy so
// the session cookie is same-origin from the browser's point of view (avoids third-party-cookie
// blocking — see next.config.ts).
const API_BASE = "/platform-api";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      // credentials: "include" is still required even same-origin-via-proxy — fetch() only sends
      // cookies by default for same-origin requests when explicitly opted in.
      const res = await fetch(`${API_BASE}/platform/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 200) {
        router.push("/platform");
        return;
      }

      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.status === 429) {
        setErrorMessage(json?.message ?? "Too many failed attempts. Try again later.");
      } else if (res.status === 401) {
        setErrorMessage(json?.message ?? "Invalid email or password.");
      } else {
        setErrorMessage(json?.message ?? "Something went wrong. Try again.");
      }
      setStatus("error");
    } catch {
      setErrorMessage("Couldn't reach the platform login service. Try again.");
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">Super Admin Login</h1>
      <p className="mt-1 text-sm text-gray-600">Platform-level access. Internal use only.</p>

      {status === "error" && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      )}

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-900">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-900">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          />
        </div>
        <Button type="submit" className="w-full" isLoading={status === "loading"}>
          Log in
        </Button>
      </form>
    </main>
  );
}
