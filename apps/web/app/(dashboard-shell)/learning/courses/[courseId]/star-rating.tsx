"use client";

import { Star } from "lucide-react";

/** A 1–5 star rating display, supporting half-stars (e.g. a 4.6 average renders as 4 full stars
 * + 1 half star) via a clipped overlay star on top of an empty outline star. */
export function StarRating({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const dimension = size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((position) => {
        const fillPercent = Math.max(0, Math.min(1, value - (position - 1))) * 100;
        return (
          <span key={position} className="relative inline-block">
            <Star className={`${dimension} text-slate-200`} fill="currentColor" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fillPercent}%` }}>
              <Star className={`${dimension} text-amber-400`} fill="currentColor" />
            </span>
          </span>
        );
      })}
    </div>
  );
}
