"use client";

// Client Component — the tenant's login page (spec 005 US2/US3/US6). Fetches through
// next.config.ts's /tenant-api/* rewrite proxy (relative path), never API_ORIGIN directly, so the
// tm_tenant_session cookie stays same-origin from the browser's point of view (mirrors the Super
// Admin cookie fix — see next.config.ts).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

const SSO_LABELS: Record<string, string> = {
  microsoft: "Microsoft",
  google_workspace: "Google Workspace",
  zoho: "Zoho",
};

export default function TenantLoginForm({
  subdomain,
  tenantName,
  enabledAuthMethods,
}: {
  subdomain: string;
  tenantName: string;
  enabledAuthMethods: string[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [ssoNotice, setSsoNotice] = useState<string | null>(null);

  const showEmailPassword = enabledAuthMethods.includes("email_password");
  const ssoMethods = enabledAuthMethods.filter((m) => m !== "email_password");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch(`${API_BASE}/login?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = (await res.json().catch(() => null)) as
        | { data?: { mustChangePassword?: boolean }; message?: string }
        | null;

      if (res.status === 200) {
        router.push(json?.data?.mustChangePassword ? "/set-password" : "/dashboard");
        router.refresh();
        return;
      }
      if (res.status === 429) {
        setErrorMessage(json?.message ?? "Too many failed attempts. Try again later.");
      } else {
        setErrorMessage(json?.message ?? "Invalid email or password.");
      }
      setStatus("error");
    } catch {
      setErrorMessage("Couldn't reach the login service. Try again.");
      setStatus("error");
    }
  }

  return (
    <main className="login-split">
      <div className="login-brand-panel">
        <span className="truncate text-lg font-semibold tracking-tight capitalize">{tenantName}</span>

        <div className="relative z-10">
          <h2 className="font-heading text-4xl font-bold leading-tight tracking-tight text-balance">
            Empower Your Team to Learn, Grow, and Succeed
          </h2>
          <p className="mt-4 max-w-md text-base text-slate-300">
            Sign in to build training, track employee progress, and grow your team&apos;s skills — all
            in one place.
          </p>
        </div>

        <div aria-hidden="true" className="relative mt-12 h-64 flex-1">
          <div className="login-brand-panel-glow -top-8 right-0 h-72 w-72" />
          <div className="login-brand-panel-glow bottom-0 left-8 h-56 w-56 bg-white/10" />
          <div className="login-brand-shape top-8 left-4 h-28 w-52 -rotate-3" />
          <div className="login-brand-shape top-32 left-28 h-24 w-56 rotate-2" />
          <div className="login-brand-shape top-[13.5rem] left-2 h-20 w-40 -rotate-1" />
        </div>
      </div>

      <div className="login-form-column">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight text-primary truncate">
            Welcome to <span className="capitalize">{tenantName}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">Sign in to your workspace.</p>

          {status === "error" && (
            <div role="alert" className="banner-error mt-6">
              {errorMessage}
            </div>
          )}

          {showEmailPassword && (
            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <Input
                label="Email"
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div>
                <Input
                  label="Password"
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <a
                  href="/forgot-password"
                  className="mt-1.5 inline-block text-sm font-medium text-cta hover:text-cta-hover"
                >
                  Forgot password?
                </a>
              </div>
              <Button type="submit" className="w-full" isLoading={status === "loading"}>
                Log in
              </Button>
            </form>
          )}

          {showEmailPassword && ssoMethods.length > 0 && (
            <div className="divider-with-label my-6">
              <span>or</span>
            </div>
          )}

          {ssoMethods.length > 0 && (
            <div className="space-y-3">
              {ssoMethods.map((method) => (
                <Button
                  key={method}
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setSsoNotice(SSO_LABELS[method] ?? method)}
                >
                  Continue with {SSO_LABELS[method] ?? method}
                </Button>
              ))}
              {ssoNotice && (
                <p role="status" className="banner-info text-center">
                  {ssoNotice} sign-in isn&apos;t available yet — check back soon.
                </p>
              )}
            </div>
          )}

          {!showEmailPassword && ssoMethods.length === 0 && (
            <p className="banner-error mt-6">
              No login method is currently configured for this workspace. Contact your administrator.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
