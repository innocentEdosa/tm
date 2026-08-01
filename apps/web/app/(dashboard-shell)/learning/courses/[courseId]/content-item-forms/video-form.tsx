"use client";

import { useState } from "react";
import { ChevronLeft, Monitor, Play, Upload, Video as VideoIcon } from "lucide-react";
import { Card, Input, Button, Modal } from "@tm/ui";
import { type ContentItemTarget, type ContentItem } from "@/lib/course-api-types";
import { useAutoSaveContentItem, AutoSaveIndicator } from "./use-autosave-content-item";
import { LessonDetailsSection, LessonResourcesSection, SectionHeading } from "./lesson-form-sections";

type VideoMethod = "url" | "upload" | "record-video" | "record-screen";

function VideoMethodCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg bg-slate-50 px-4 py-10 text-center hover:bg-slate-100"
    >
      <span className="text-secondary">{icon}</span>
      <span className="text-sm font-medium text-primary">{label}</span>
    </button>
  );
}

/** The `video` content-item form — first asks how the video should be added (matching the design's
 * method picker), then — for the only method that's actually wired up, a video URL — Lesson Details
 * (title/description), Lesson Content (a single required URL, matching
 * `content-item-payload-validation.ts`'s `video` shape — no file upload for video, spec FR-018,
 * stays URL-only matching spec 024's own decision), and Lesson Resources. The other three methods
 * (upload/record-a-video/record-your-screen) would need real media capture and storage this mock
 * app doesn't have, so they show a "coming soon" note instead of pretending to work. Autosaves as a
 * draft (no submit button) once a title and URL are both present. */
export default function VideoForm({
  courseId,
  target,
  onClose,
  onCreated,
  editingItem,
}: {
  courseId: string;
  target: ContentItemTarget;
  onClose: () => void;
  onCreated?: (id: string) => void;
  editingItem?: ContentItem;
}) {
  const [method, setMethod] = useState<VideoMethod | null>(editingItem ? "url" : null);
  const [comingSoonOpen, setComingSoonOpen] = useState(false);
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [url, setUrl] = useState(editingItem?.payload.url ?? "");
  const { status, savedItemId, scheduleSave } = useAutoSaveContentItem(courseId, target, onCreated, editingItem?.id);

  function save(next: { title: string; description: string; url: string }) {
    scheduleSave({ type: "video", title: next.title, description: next.description || undefined, payload: { url: next.url } });
  }

  function pickMethod(next: VideoMethod) {
    if (next === "url") {
      setMethod(next);
      return;
    }
    setComingSoonOpen(true);
  }

  if (method === null) {
    return (
      <Card>
        <SectionHeading first>How would you like to add this video?</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <VideoMethodCard icon={<Play className="h-6 w-6" />} label="Use a video URL" onClick={() => pickMethod("url")} />
          <VideoMethodCard icon={<Upload className="h-6 w-6" />} label="Upload a file" onClick={() => pickMethod("upload")} />
          <VideoMethodCard icon={<VideoIcon className="h-6 w-6" />} label="Record a video" onClick={() => pickMethod("record-video")} />
          <VideoMethodCard icon={<Monitor className="h-6 w-6" />} label="Record your screen" onClick={() => pickMethod("record-screen")} />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <Modal open={comingSoonOpen} onClose={() => setComingSoonOpen(false)} title="Coming soon">
          <p className="text-sm text-secondary">This way of adding a video isn&apos;t available yet. For now, use a video URL.</p>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setComingSoonOpen(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      </Card>
    );
  }

  return (
    <Card>
      <button type="button" onClick={() => setMethod(null)} className="mb-3 flex cursor-pointer items-center gap-1 text-sm text-secondary hover:text-primary">
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      <LessonDetailsSection
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          save({ title: value, description, url });
        }}
        description={description}
        onDescriptionChange={(value) => {
          setDescription(value);
          save({ title, description: value, url });
        }}
      />

      <SectionHeading>Lesson Content</SectionHeading>
      <Input
        label="Video URL"
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          save({ title, description, url: e.target.value });
        }}
        required
      />

      <LessonResourcesSection contentItemId={savedItemId} />

      <div className="mt-10 flex items-center gap-3">
        <Button type="button" variant="outline" onClick={onClose}>
          Done
        </Button>
        <AutoSaveIndicator status={status} />
      </div>
    </Card>
  );
}
