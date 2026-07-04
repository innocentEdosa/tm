"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

// The forced OTP-bootstrap flow (spec FR-013a) — deliberately reassuring in tone, not an error
// state: the account already works, this is just the last step.
export default function SetPasswordForm({ subdomain }: { subdomain: string }) {
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
        router.push("/tenant");
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="banner-info">You&apos;re almost in — just set your own password.</div>
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
    </main>
  );
}
