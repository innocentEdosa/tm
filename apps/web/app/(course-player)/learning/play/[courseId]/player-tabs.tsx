"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import ReviewsTabContent from "./reviews-tab-content";

type TabKey = "search" | "overview" | "qa" | "notes" | "reviews" | "learning-tools";

const TEXT_TABS: { key: Exclude<TabKey, "search">; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "qa", label: "Q&A" },
  { key: "notes", label: "Notes" },
  { key: "reviews", label: "Reviews" },
  { key: "learning-tools", label: "Learning tools" },
];

/**
 * The tab strip below the lesson media (spec ask: match Udemy's own Overview/Q&A/Notes/Reviews/
 * Learning-tools row, minus "Announcements"). "Overview" (title/description/mark-complete/
 * resources), "Search", and "Reviews" have real content today — Q&A/Notes/Learning-tools are stubs,
 * filled in one at a time as their own reference screenshot arrives.
 */
export default function PlayerTabs({ courseId, overview }: { courseId: string; overview: React.ReactNode }) {
  const [active, setActive] = useState<TabKey>("overview");

  return (
    <div>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2">
        <button
          type="button"
          onClick={() => setActive("search")}
          aria-label="Search course content"
          data-active={active === "search"}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center text-secondary hover:text-primary data-[active=true]:text-primary data-[active=true]:after:absolute data-[active=true]:after:inset-x-2 data-[active=true]:after:bottom-0 data-[active=true]:after:h-0.5 data-[active=true]:after:rounded-full data-[active=true]:after:bg-primary"
        >
          <Search className="h-4 w-4" />
        </button>

        {TEXT_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            data-active={active === tab.key}
            className="relative flex h-11 shrink-0 items-center px-4 text-sm font-medium whitespace-nowrap text-secondary hover:text-primary data-[active=true]:text-primary data-[active=true]:after:absolute data-[active=true]:after:inset-x-3 data-[active=true]:after:bottom-0 data-[active=true]:after:h-0.5 data-[active=true]:after:rounded-full data-[active=true]:after:bg-primary"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {active === "search" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex w-full max-w-md items-center gap-2">
              <input type="search" className="field-input" placeholder="Search course content" />
            </div>
            <p className="mt-4 text-base font-semibold text-primary">Start a new search</p>
            <p className="text-sm text-muted">To find lessons or resources</p>
          </div>
        )}
        {active === "overview" && overview}
        {active === "reviews" && <ReviewsTabContent courseId={courseId} />}
        {(active === "qa" || active === "notes" || active === "learning-tools") && (
          <p className="py-10 text-center text-sm text-muted">Nothing here yet.</p>
        )}
      </div>
    </div>
  );
}
