"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Toggle } from "@tm/ui";

const API_BASE = "/tenant-api/tenant-auth";

const METHOD_OPTIONS: { key: string; label: string; description: string }[] = [
  { key: "email_password", label: "Email & Password", description: "Standard email/password login." },
  { key: "microsoft", label: "Microsoft", description: "Sign in with a Microsoft account." },
  { key: "google_workspace", label: "Google Workspace", description: "Sign in with Google Workspace." },
  { key: "zoho", label: "Zoho", description: "Sign in with Zoho." },
];

class ForbiddenError extends Error {}

async function fetchMethods(subdomain: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/settings/methods?subdomain=${encodeURIComponent(subdomain)}`, {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 403) throw new ForbiddenError();
  if (!res.ok) throw new Error("load-failed");
  const json = (await res.json()) as { data: { methods: string[] } };
  return json.data.methods;
}

export default function AuthenticationSettingsClient({ subdomain }: { subdomain: string }) {
  const queryClient = useQueryClient();
  const methodsQuery = useQuery({
    queryKey: ["auth-settings-methods", subdomain],
    queryFn: () => fetchMethods(subdomain),
    retry: false,
  });
  const [methods, setMethods] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (methodsQuery.data) setMethods(methodsQuery.data);
  }, [methodsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (nextMethods: string[]) => {
      const res = await fetch(`${API_BASE}/settings/methods?subdomain=${encodeURIComponent(subdomain)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ methods: nextMethods }),
      });
      if (res.status === 409) throw new Error("At least one login method must stay enabled.");
      if (!res.ok) throw new Error("Couldn't save changes. Try again.");
    },
    onSuccess: () => {
      setSaveStatus("saved");
      queryClient.invalidateQueries({ queryKey: ["auth-settings-methods", subdomain] });
    },
    onError: (err: Error) => {
      setSaveError(err.message || "Couldn't reach the server. Try again.");
      setSaveStatus("error");
    },
  });

  function toggleMethod(key: string, checked: boolean) {
    setMethods((prev) => (checked ? [...prev, key] : prev.filter((m) => m !== key)));
    setSaveStatus("idle");
  }

  function handleSave() {
    setSaveStatus("saving");
    setSaveError("");
    saveMutation.mutate(methods);
  }

  if (methodsQuery.isPending) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-slate-600">Loading…</p>
      </main>
    );
  }

  if (methodsQuery.error instanceof ForbiddenError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="banner-error">
          You don&apos;t have permission to manage authentication settings for this workspace.
        </div>
      </main>
    );
  }

  if (methodsQuery.error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="banner-error">Couldn&apos;t load authentication settings. Try refreshing.</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-primary">Authentication settings</h1>
      <p className="mt-2 text-sm text-slate-600">
        Choose which login methods are available to your team. More than one can be active at once.
      </p>

      <div className="surface-card mt-8 divide-y divide-border">
        {METHOD_OPTIONS.map((option) => (
          <Toggle
            key={option.key}
            label={option.label}
            description={option.description}
            checked={methods.includes(option.key)}
            onChange={(checked) => toggleMethod(option.key, checked)}
          />
        ))}
      </div>

      {methods.length === 0 && (
        <p className="field-error mt-3">At least one login method must remain enabled.</p>
      )}
      {saveStatus === "error" && <p className="field-error mt-3">{saveError}</p>}
      {saveStatus === "saved" && <p className="mt-3 text-sm text-green-700">Saved.</p>}

      <Button
        className="mt-6"
        onClick={handleSave}
        disabled={methods.length === 0}
        isLoading={saveStatus === "saving"}
      >
        Save changes
      </Button>
    </main>
  );
}
