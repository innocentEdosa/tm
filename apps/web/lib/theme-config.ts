const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

export const THEMES = ["violet", "navy"] as const;
export type Theme = (typeof THEMES)[number];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Server-only (Server Components). Mirrors `platform-session.ts`'s server-to-server `fetch` shape,
 * but unauthenticated — apps/api's `GET /platform/theme` is intentionally public (UI Theme
 * Switching). Called from the root layout so `<html data-theme>` is set before first paint, with no
 * client-side flash of the wrong theme.
 *
 * `revalidate: 30` rather than `no-store`: this fetch runs on every single page render app-wide
 * (tenant, platform, and logged-out), and the active theme changes rarely (a Super Admin flipping a
 * setting, not a per-request value) — a 30s-stale cache is an easy trade for not hitting the API/DB
 * on every request. A Super Admin's change is visible to everyone within 30 seconds.
 */
export async function getActiveTheme(): Promise<Theme> {
  try {
    const res = await fetch(`${API_ORIGIN}/platform/theme`, { next: { revalidate: 30 } });
    if (!res.ok) return "navy";
    const body = (await res.json()) as { data?: { theme?: string } };
    return isTheme(body.data?.theme) ? body.data.theme : "navy";
  } catch {
    return "navy";
  }
}
