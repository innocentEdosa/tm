"use client";

import { useState } from "react";
import { Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

export default function ResetPasswordForm({
  subdomain,
  token,
}: {
  subdomain: string;
  token: string;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
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
      const res = await fetch(`${API_BASE}/reset-password?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      if (res.ok) {
        setStatus("done");
        return;
      }
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      setErrorMessage(json?.message ?? "This reset link is invalid or has expired.");
      setStatus("error");
    } catch {
      setErrorMessage("Couldn't reach the server. Try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12 text-center">
        <div className="banner-success">Your password has been reset.</div>
        <a href="/tenant" className="mt-6 text-sm font-medium text-cta hover:text-cta-hover">
          Log in
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-primary">Set a new password</h1>

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
          Reset password
        </Button>
      </form>
    </main>
  );
}
