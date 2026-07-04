"use client";

import { useState } from "react";
import { Button, Input } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

// Deliberately minimal (spec Assumptions/FR-018) — a single form, no pending-invitation list,
// resend, or revoke UI.
export default function TeamSettingsClient({ subdomain }: { subdomain: string }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/team?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, email, roleId }),
      });
      if (res.status === 201) {
        setMessage({ kind: "success", text: `Invitation sent to ${email}.` });
        setFullName("");
        setEmail("");
        setRoleId("");
        setStatus("idle");
        return;
      }
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage({
        kind: "error",
        text: json?.message ?? "Couldn't add this team member. Try again.",
      });
      setStatus("error");
    } catch {
      setMessage({ kind: "error", text: "Couldn't reach the server. Try again." });
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-primary">Team members</h1>
      <p className="mt-2 text-sm text-slate-600">
        Add a new team member — they&apos;ll receive an email with a one-time password to get started.
      </p>

      {message && (
        <div className={message.kind === "success" ? "banner-success mt-6" : "banner-error mt-6"}>
          {message.text}
        </div>
      )}

      <form className="surface-card mt-6 space-y-5" onSubmit={handleSubmit}>
        <Input
          label="Full name"
          id="fullName"
          name="fullName"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Input
          label="Email"
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Role ID"
          id="roleId"
          name="roleId"
          required
          hint="The role's identifier, as assigned within your organization."
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        />
        <Button type="submit" isLoading={status === "loading"}>
          Add team member
        </Button>
      </form>
    </main>
  );
}
