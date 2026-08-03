"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, FileDown, FolderOpen, Radio } from "lucide-react";
import { Popover } from "@tm/ui";
import { tenantFetch, openAttachment } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import { buildCourseOutline, type Curriculum, type ContentItem, type Attachment } from "@/lib/course-api-types";
import { TYPE_ICON, TYPE_LABEL } from "@/app/(dashboard-shell)/learning/courses/[courseId]/content-item-type-picker";

type ProgressStatus = "not_started" | "in_progress" | "completed" | "failed";

/** A pill trigger + dropdown of a lesson's resources — only renders once its attachments have
 * loaded and turn out non-empty, so a lesson with nothing attached shows no pill at all. Stops its
 * own click from bubbling up to the row's `onSelect` (opening the dropdown must not also switch the
 * active lesson), and the dropdown itself is a portal (`Popover`), so it never ends up nested inside
 * the row's own `<button>`. */
function ResourcesMenu({ contentItemId }: { contentItemId: string }) {
  const subdomain = useSubdomain();
  const { data: resources } = useQuery({
    queryKey: ["item-attachments", contentItemId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Attachment[] }>(`/content-items/${contentItemId}/attachments`, { subdomain });
      return data;
    },
  });

  if (!resources || resources.length === 0) return null;

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Popover
        align="end"
        width={220}
        trigger={
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-cta px-3 py-1.5 text-sm font-medium text-cta hover:bg-cta/5">
            <FolderOpen className="h-4 w-4" />
            Resources
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        }
      >
        {resources.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openAttachment(r, subdomain)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
          >
            <FileDown className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate text-primary">{r.fileName}</span>
          </button>
        ))}
      </Popover>
    </span>
  );
}

function ItemRow({
  item,
  status,
  active,
  onSelect,
  onToggleComplete,
}: {
  item: ContentItem;
  status: ProgressStatus;
  active: boolean;
  onSelect: () => void;
  onToggleComplete: () => void;
}) {
  const completed = status === "completed";
  const isFutureLive = item.type === "live_class" && !!item.payload.scheduledAt && new Date(item.payload.scheduledAt).getTime() > Date.now();

  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 data-[active=true]:bg-cta/5"
    >
      <span
        role="checkbox"
        aria-checked={completed}
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onToggleComplete();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onToggleComplete();
          }
        }}
        className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-slate-300 bg-white text-white data-[checked=true]:border-cta data-[checked=true]:bg-cta"
        data-checked={completed}
      >
        {completed && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>

      <span className="mt-0.5 shrink-0 text-slate-400 group-data-[active=true]:text-cta">{TYPE_ICON[item.type]}</span>

      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${active ? "font-semibold text-cta" : "text-primary"}`}>{item.title}</span>
        <span className="mt-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            {isFutureLive ? (
              <span className="flex items-center gap-1 font-semibold text-red-600">
                <Radio className="h-3 w-3" /> Live
              </span>
            ) : (
              TYPE_LABEL[item.type]
            )}
          </span>
          <ResourcesMenu contentItemId={item.id} />
        </span>
      </span>
    </button>
  );
}

/**
 * The "Course content" sidebar — modules render as collapsible sections (spec ask: match Udemy's
 * layout), standalone lessons render as bare rows in between, exactly interleaved per
 * `buildCourseOutline`'s own real display order. Only the module containing the initially-active
 * item starts expanded; every other module starts collapsed, same as Udemy's own default.
 */
export default function PlayerSidebar({
  curriculum,
  activeItemId,
  progressByItemId,
  onSelectItem,
  onToggleComplete,
}: {
  curriculum: Curriculum;
  activeItemId: string | null;
  progressByItemId: Map<string, ProgressStatus>;
  onSelectItem: (item: ContentItem) => void;
  onToggleComplete: (item: ContentItem) => void;
}) {
  const outline = buildCourseOutline(curriculum);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = outline.find((entry) => entry.kind === "module" && entry.module.contentItems?.some((i) => i.id === activeItemId));
    return new Set(initial ? [initial.id] : []);
  });

  function toggleModule(moduleId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  if (outline.length === 0) {
    return <p className="p-4 text-sm text-muted">This course doesn&apos;t have any content yet.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {outline.map((entry) => {
        if (entry.kind === "lesson") {
          return (
            <ItemRow
              key={entry.id}
              item={entry.item}
              status={progressByItemId.get(entry.item.id) ?? "not_started"}
              active={entry.item.id === activeItemId}
              onSelect={() => onSelectItem(entry.item)}
              onToggleComplete={() => onToggleComplete(entry.item)}
            />
          );
        }

        const items = entry.module.contentItems ?? [];
        const completedCount = items.filter((i) => progressByItemId.get(i.id) === "completed").length;
        const open = expanded.has(entry.id);

        return (
          <div key={entry.id}>
            <button
              type="button"
              onClick={() => toggleModule(entry.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 bg-slate-50 px-4 py-3.5 text-left hover:bg-slate-100"
            >
              <span className="min-w-0">
                <span className="block truncate text-base font-bold text-primary">{entry.module.title}</span>
                <span className="text-xs text-muted">
                  {completedCount} / {items.length} lessons
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-primary transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    status={progressByItemId.get(item.id) ?? "not_started"}
                    active={item.id === activeItemId}
                    onSelect={() => onSelectItem(item)}
                    onToggleComplete={() => onToggleComplete(item)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
