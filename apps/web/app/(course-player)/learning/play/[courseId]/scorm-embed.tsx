"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createScormApi, type LaunchData } from "@/lib/scorm-rte-api";

declare global {
  interface Window {
    API?: ReturnType<typeof createScormApi>;
  }
}

async function fetchLaunchData(contentItemId: string): Promise<LaunchData> {
  const res = await fetch(`/tenant-api/tenant/content-items/${contentItemId}/scorm/launch`, { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 404 ? "This package hasn't been imported yet." : "Unable to load this SCORM package.");
  const body = await res.json();
  return body.data;
}

/**
 * Embeds a single SCO inline in the course player's content pane — the same launch-fetch +
 * `window.API` injection as the standalone `/learning/scorm/[contentItemId]` page
 * (`scorm-launcher-client.tsx`), just sized to sit inside this layout instead of owning the whole
 * page. The SCO commits its own progress via `createScormApi`'s synchronous `.../scorm/cmi` XHR,
 * which is why `player-content.tsx` hides the generic "Mark as complete" control for this type.
 */
export default function ScormEmbed({ contentItemId }: { contentItemId: string }) {
  const { data: launchData, error } = useQuery({
    queryKey: ["scorm-launch", contentItemId],
    queryFn: () => fetchLaunchData(contentItemId),
  });

  useEffect(() => {
    if (!launchData) return;
    window.API = createScormApi(launchData, contentItemId);
    return () => {
      delete window.API;
    };
  }, [launchData, contentItemId]);

  if (error) {
    return <div className="banner-error m-4">{(error as Error).message}</div>;
  }

  if (!launchData) {
    return <div className="flex h-[70vh] items-center justify-center bg-slate-50 text-sm text-muted">Loading…</div>;
  }

  return <iframe title="SCORM content" src={launchData.entryPointUrl} className="h-[70vh] w-full border-0 bg-white" />;
}
