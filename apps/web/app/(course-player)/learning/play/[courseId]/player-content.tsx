"use client";

import { CalendarClock, ExternalLink } from "lucide-react";
import type { ContentItem } from "@/lib/course-api-types";
import ScormEmbed from "./scorm-embed";

/** Viewport-relative rather than a fixed px guess, so it scales the same way a 16:9 video's own
 * height does as the window resizes (and matches the article case's own `max-h-[70vh]` scale) —
 * every non-video lesson type below floors its height to this, so moving from a video lesson to a
 * short article/live-class/test placeholder doesn't yank the whole page up. */
const MIN_MEDIA_HEIGHT = "min-h-[60vh]";

/** Recognizes a YouTube or Vimeo URL and returns its embeddable-iframe form; any other URL (a direct
 * file, a presigned R2 link, etc.) is treated as a playable file and handed straight to a `<video>`
 * tag instead — `payload.url` is an arbitrary admin-entered string (video-form.tsx only wires up
 * "video URL", not file upload), so there's no stored flag saying which case it is. */
function getVideoEmbedUrl(url: string): string | null {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

function formatScheduledAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EmptyMedia({ message }: { message: string }) {
  return <div className="flex aspect-video w-full items-center justify-center bg-slate-900 px-6 text-center text-sm text-slate-400">{message}</div>;
}

/** The content-type-aware media renderer alone — video/article/live-class/SCORM/etc. — with no
 * title, description, or complete-toggle chrome around it; those now live in the "Overview" tab
 * body (`player-tabs.tsx`), assembled by `course-player-client.tsx`. */
export default function LessonMedia({ item, onVideoEnded }: { item: ContentItem; onVideoEnded: () => void }) {
  switch (item.type) {
    case "video": {
      const url = item.payload.url;
      if (!url) return <EmptyMedia message="No video has been added to this lesson yet." />;
      const embedUrl = getVideoEmbedUrl(url);
      if (embedUrl) {
        return (
          <iframe
            title={item.title}
            src={embedUrl}
            allow="autoplay; fullscreen; picture-in-picture"
            className="aspect-video w-full border-0"
          />
        );
      }
      return <video controls src={url} onEnded={onVideoEnded} className="aspect-video w-full bg-black" />;
    }

    case "article":
      return (
        <div className={`${MIN_MEDIA_HEIGHT} max-h-[70vh] overflow-y-auto bg-white p-6`}>
          {/* Trusted admin-authored HTML from the Tiptap `RichTextEditor` — same trust boundary
             already accepted for course descriptions (course-card.tsx's `stripHtml` comment). This
             is the first place that renders it as real markup rather than a stripped preview, since a
             lesson's whole point is showing its actual content. */}
          <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: item.payload.body ?? "<p>No content yet.</p>" }} />
        </div>
      );

    case "live_class":
      return (
        <div className={`flex ${MIN_MEDIA_HEIGHT} flex-col items-center justify-center gap-3 bg-white px-6 text-center`}>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cta/10 text-cta">
            <CalendarClock className="h-7 w-7" />
          </span>
          <p className="text-base font-semibold text-primary">Live session</p>
          <p className="text-sm text-secondary">{item.payload.scheduledAt ? formatScheduledAt(item.payload.scheduledAt) : "No schedule set yet."}</p>
        </div>
      );

    case "test":
    case "assignment":
      return (
        <div className={`flex ${MIN_MEDIA_HEIGHT} flex-col items-center justify-center gap-2 bg-white px-6 text-center`}>
          <p className="text-sm text-muted">Your instructor hasn&apos;t added additional content here yet.</p>
        </div>
      );

    case "external_import":
      if (item.payload.sourceType === "scorm") {
        return <ScormEmbed contentItemId={item.id} />;
      }
      return (
        <div className={`flex ${MIN_MEDIA_HEIGHT} flex-col items-center justify-center gap-3 bg-white px-6 text-center`}>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cta/10 text-cta">
            <ExternalLink className="h-7 w-7" />
          </span>
          {item.payload.externalUrl ? (
            <a href={item.payload.externalUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-md">
              Open resource
            </a>
          ) : (
            <p className="text-sm text-muted">No resource link has been added yet.</p>
          )}
        </div>
      );

    default:
      return null;
  }
}
