"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

// The forced OTP-bootstrap flow (spec FR-013a) — deliberately reassuring in tone, not an error
// state: the account already works, this is just the last step.
export default function SetPasswordForm({
  subdomain,
  tenantName,
}: {
  subdomain: string;
  tenantName: string;
}) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords don't match.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(`${API_BASE}/set-password?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      if (res.status === 204) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      setErrorMessage(json?.message ?? "Couldn't set your password. Try again.");
      setStatus("error");
    } catch {
      setErrorMessage("Couldn't reach the server. Try again.");
      setStatus("error");
    }
  }

  return (
    <main className="login-split">
      <div className="login-form-column">
        <div className="w-full max-w-sm">
          <span className="block truncate text-lg font-semibold tracking-tight text-primary capitalize">
            {tenantName}
          </span>

          <div className="banner-info mt-4">You&apos;re almost in — just set your own password.</div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-primary">Choose your password</h1>

          {status === "error" && (
            <div role="alert" className="banner-error mt-6">
              {errorMessage}
            </div>
          )}

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <Input
              label="New password"
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Input
              label="Confirm password"
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <Button type="submit" className="w-full" isLoading={status === "loading"}>
              Continue
            </Button>
          </form>
        </div>
      </div>

      <div className="login-brand-panel">
        <div aria-hidden="true" className="relative h-full w-full">
          <div className="login-brand-panel-glow -top-8 right-0 h-72 w-72" />
          <div className="login-brand-panel-glow bottom-0 left-8 h-56 w-56 bg-white/10" />
          <div className="login-brand-shape top-8 left-4 h-28 w-52 -rotate-3" />
          <div className="login-brand-shape top-32 left-28 h-24 w-56 rotate-2" />
          <div className="login-brand-shape top-[13.5rem] left-2 h-20 w-40 -rotate-1" />
        </div>
      </div>
    </main>
  );
}
