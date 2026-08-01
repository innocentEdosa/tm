"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ClipboardList, FileText, ListChecks, Radio, Sparkles, UploadCloud, Video } from "lucide-react";
import { Button, Modal, Popover, PopoverMenuItem } from "@tm/ui";
import type { ContentItemType } from "@/lib/course-api-types";

/** Shared with `curriculum-tab.tsx` — a lesson row shows this icon instead of spelling out its type. */
export const TYPE_ICON: Record<ContentItemType, ReactNode> = {
  video: <Video className="h-4 w-4" />,
  article: <FileText className="h-4 w-4" />,
  live_class: <Radio className="h-4 w-4" />,
  test: <ListChecks className="h-4 w-4" />,
  assignment: <ClipboardList className="h-4 w-4" />,
  external_import: <UploadCloud className="h-4 w-4" />,
};

const TYPE_LABEL: Record<ContentItemType, string> = {
  video: "Video",
  article: "Article",
  live_class: "Live class",
  test: "Test",
  assignment: "Assignment",
  external_import: "External import",
};

/** All 6 content-item types (spec FR-009/FR-010) — no more, no fewer, matching spec 024's real
 * `content_items.type` CHECK exactly (data-model.md). */
const TYPES: ContentItemType[] = ["video", "article", "live_class", "test", "assignment", "external_import"];

/**
 * The icon+label rows shared by every "add a lesson" entry point — the module-header "+ Add
 * Content" trigger AND the top-level "Add Content > Lesson" menu — so both show the exact same
 * popover regardless of where they're opened from. "Generate with AI" is a non-functional "coming
 * soon" entry (spec 028 FR-002/FR-017 — no real AI-driven content generation in this spec), same
 * treatment as `create-course-menu.tsx`'s own AI entry.
 */
export function ContentItemTypeMenuItems({
  close,
  onPick,
  onAiPick,
}: {
  close: () => void;
  onPick: (type: ContentItemType) => void;
  onAiPick: () => void;
}) {
  return (
    <>
      <PopoverMenuItem
        hero
        icon={<Sparkles className="h-4 w-4" />}
        title="Generate with AI"
        subtitle="Draft this lesson's content with AI"
        onClick={() => {
          close();
          onAiPick();
        }}
      />
      {TYPES.map((type) => (
        <PopoverMenuItem
          key={type}
          icon={TYPE_ICON[type]}
          title={TYPE_LABEL[type]}
          onClick={() => {
            close();
            onPick(type);
          }}
        />
      ))}
    </>
  );
}

export function AiContentComingSoonModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Coming soon">
      <p className="text-sm text-secondary">
        AI-assisted content generation isn&apos;t available yet. For now, pick a content type above to add it manually.
      </p>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Got it
        </Button>
      </div>
    </Modal>
  );
}

/**
 * The "Add content" picker anchored to the module-header "+ Add Content" trigger (the top-level
 * "Add Content > Lesson" flow reuses `ContentItemTypeMenuItems` directly inside its own popover
 * instead — see `curriculum-tab.tsx` — since it isn't anchored to a per-module button).
 */
export default function ContentItemTypePicker({
  trigger,
  open,
  onOpenChange,
  onPick,
}: {
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: ContentItemType) => void;
}) {
  const [aiModalOpen, setAiModalOpen] = useState(false);

  return (
    <>
      <Popover trigger={trigger} open={open} onOpenChange={onOpenChange} width={260} align="start">
        {(close) => <ContentItemTypeMenuItems close={close} onPick={onPick} onAiPick={() => setAiModalOpen(true)} />}
      </Popover>

      <AiContentComingSoonModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} />
    </>
  );
}
