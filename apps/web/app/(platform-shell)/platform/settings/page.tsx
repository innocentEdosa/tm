"use client";

// UI Theme Switching — lets a Super Admin flip the whole app's active design between "navy"
// (current default — deep-blue accent, dark sidebar) and "violet" (purple accent, light sidebar,
// rounder corners). Global, not per-tenant: every tenant and the platform dashboard itself all
// render whichever theme is active here. Backed by apps/api's `platform_settings` table (GET is
// public, PATCH is Super-Admin-only) — the root layout (apps/web/app/layout.tsx) reads the same
// GET on every request to set `<html data-theme>`.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Card, Toggle } from "@tm/ui";

const API_BASE = "/platform-api";

type Theme = "violet" | "navy";

interface ThemeData {
  theme: Theme;
}

export default function PlatformSettingsPage() {
  const queryClient = useQueryClient();

  const themeQuery = useQuery({
    queryKey: ["platform-theme"],
    queryFn: async (): Promise<ThemeData> => {
      const res = await fetch(`${API_BASE}/platform/theme`, { credentials: "include" });
      const json = (await res.json()) as { data: ThemeData };
      return json.data;
    },
  });

  const setThemeMutation = useMutation({
    mutationFn: async (theme: Theme) => {
      const res = await fetch(`${API_BASE}/platform/theme`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? "Couldn't update the theme.");
      }
      return (await res.json()) as { data: ThemeData };
    },
    onSuccess: ({ data }) => {
      queryClient.setQueryData(["platform-theme"], data);
    },
  });

  const theme = themeQuery.data?.theme ?? "navy";

  return (
    <main className="px-8 py-8">
      <PageHeader title="Platform Settings" subtitle="Controls that apply to every tenant and the platform dashboard." />

      <Card className="mt-6 max-w-xl">
        <h2 className="text-sm font-semibold text-primary">Appearance</h2>
        <p className="mt-1 text-sm text-slate-500">
          Applies immediately for every tenant and the platform dashboard — not per-tenant.
        </p>

        <div className="mt-4 divide-y divide-border">
          <Toggle
            checked={theme === "navy"}
            disabled={themeQuery.isLoading || setThemeMutation.isPending}
            onChange={(checked) => setThemeMutation.mutate(checked ? "navy" : "violet")}
            label="Navy theme"
            description={
              theme === "navy"
                ? "Active — deep-blue accent, dark sidebar."
                : "Off — violet theme active (purple accent, light sidebar)."
            }
          />
        </div>

        {setThemeMutation.isError && (
          <p className="mt-3 text-sm text-red-600">{(setThemeMutation.error as Error).message}</p>
        )}
      </Card>
    </main>
  );
}
