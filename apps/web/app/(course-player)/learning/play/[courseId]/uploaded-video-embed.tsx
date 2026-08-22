"use client";

import { useQuery } from "@tanstack/react-query";

async function fetchDownloadUrl(attachmentId: string): Promise<string> {
  const res = await fetch(`/tenant-api/tenant/attachments/${attachmentId}/download-url`, { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 404 ? "This video is no longer available." : "Unable to load this video.");
  const body = await res.json();
  return body.data.downloadUrl;
}

/**
 * Plays an uploaded (R2-backed) video lesson — mirrors `scorm-embed.tsx`'s exact fetch-then-render
 * shape (a presigned URL resolved through the existing attachment route, never stored). The download
 * URL is deliberately longer-lived for a video specifically (`tenant-attachment-routes.ts`'s
 * `download-url` route, `VIDEO_DOWNLOAD_URL_EXPIRY_SECONDS`) — a `<video>` tag keeps re-requesting
 * byte ranges from this same URL for as long as playback continues, unlike a document fetched once.
 */
export default function UploadedVideoEmbed({ attachmentId, title, onEnded }: { attachmentId: string; title: string; onEnded: () => void }) {
  const { data: downloadUrl, error } = useQuery({
    queryKey: ["video-attachment-download-url", attachmentId],
    queryFn: () => fetchDownloadUrl(attachmentId),
  });

  if (error) {
    return <div className="flex aspect-video w-full items-center justify-center bg-slate-900 px-6 text-center text-sm text-slate-400">{(error as Error).message}</div>;
  }

  if (!downloadUrl) {
    return <div className="flex aspect-video w-full items-center justify-center bg-slate-900 text-sm text-slate-400">Loading…</div>;
  }

  return <video controls src={downloadUrl} onEnded={onEnded} title={title} className="aspect-video w-full bg-black" />;
}
