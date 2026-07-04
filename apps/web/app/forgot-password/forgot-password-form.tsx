"use client";

import { useState } from "react";
import { Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

export default function ForgotPasswordForm({ subdomain }: { subdomain: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    try {
      await fetch(`${API_BASE}/forgot-password?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      // Always shows the same confirmation regardless of outcome (spec FR-015) — never reveals
      // whether the email has an account.
      setStatus("done");
    }
  }

  if (status === "done") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12 text-center">
        <div className="banner-info">If that email exists, check your inbox for a reset link.</div>
        <a href="/tenant" className="mt-6 text-sm font-medium text-cta hover:text-cta-hover">
          Back to login
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-primary">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-600">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

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
        <Button type="submit" className="w-full" isLoading={status === "loading"}>
          Send reset link
        </Button>
      </form>
      <a href="/tenant" className="mt-6 text-center text-sm font-medium text-cta hover:text-cta-hover">
        Back to login
      </a>
    </main>
  );
}
