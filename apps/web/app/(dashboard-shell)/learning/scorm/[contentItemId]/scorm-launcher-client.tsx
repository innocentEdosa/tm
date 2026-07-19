"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Card } from "@tm/ui";
import { createScormApi, type LaunchData } from "@/lib/scorm-rte-api";

const API_BASE = "/tenant-api/tenant";

declare global {
  interface Window {
    API?: ReturnType<typeof createScormApi>;
  }
}

/**
 * Client Component: fetches launch data, injects the SCORM 1.2 RTE API object onto this component's
 * own `window` (the iframe's parent, per the standard's discovery algorithm — research.md §10), and
 * hosts the SCO in an iframe whose `src` is the file-proxy route's entry-point URL. Renders
 * always-unlocked previous/next navigation across sibling SCOs sharing the same package (spec US4,
 * FR-013).
 */
export default function ScormLauncherClient({ contentItemId }: { contentItemId: string }) {
  const [launchData, setLaunchData] = useState<LaunchData & { navigation: { position: number; packageStatus: string; scos: { contentItemId: string; title: string; position: number; status: string }[] } }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/content-items/${contentItemId}/scorm/launch`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "This package hasn't been imported yet." : "Unable to load this SCORM package.");
        return res.json();
      })
      .then((body) => {
        if (!cancelled) setLaunchData(body.data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [contentItemId]);

  useEffect(() => {
    if (!launchData) return;
    window.API = createScormApi(launchData, contentItemId);
    return () => {
      delete window.API;
    };
  }, [launchData, contentItemId]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="banner-error">{error}</div>
      </main>
    );
  }

  if (!launchData) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
      <PageHeader title="SCORM Player" />
      {launchData.navigation.scos.length > 1 ? (
        <Card>
          <nav className="flex flex-wrap gap-2">
            {launchData.navigation.scos.map((sco) => (
              <Link
                key={sco.contentItemId}
                href={`/learning/scorm/${sco.contentItemId}`}
                className={sco.contentItemId === contentItemId ? "font-semibold underline" : "text-accent"}
              >
                {sco.position + 1}. {sco.title}
              </Link>
            ))}
          </nav>
        </Card>
      ) : null}
      <iframe
        title="SCORM content"
        src={launchData.entryPointUrl}
        className="h-[75vh] w-full border-0"
      />
    </main>
  );
}
