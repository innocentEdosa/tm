"use client";

import { useState } from "react";
import { Star } from "lucide-react";

export interface StarRatingProps {
  value: number;
  size?: "sm" | "md" | "lg";
  /** Turns this into a clickable 1–5 star picker ("Leave a rating") instead of a read-only display.
   * Unfilled stars render as an amber outline (rather than the read-only display's light-gray fill)
   * and hovering previews the value a click would commit. */
  interactive?: boolean;
  onChange?: (value: number) => void;
}

const DIMENSIONS = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-8 w-8" };

/** A 1–5 star rating — read-only display by default, supporting half-stars (e.g. a 4.6 average
 * renders as 4 full stars + 1 half star) via a clipped overlay star on top of an empty outline star.
 * Pass `interactive` + `onChange` for the clickable picker variant instead. */
export function StarRating({ value, size = "sm", interactive = false, onChange }: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const dimension = DIMENSIONS[size];

  if (interactive) {
    const displayValue = hoverValue ?? value;
    return (
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHoverValue(null)}>
        {[1, 2, 3, 4, 5].map((position) => (
          <button
            key={position}
            type="button"
            role="radio"
            aria-checked={position === value}
            aria-label={`${position} star${position === 1 ? "" : "s"}`}
            onMouseEnter={() => setHoverValue(position)}
            onClick={() => onChange?.(position)}
            className="cursor-pointer text-amber-400"
          >
            <Star className={dimension} fill={position <= displayValue ? "currentColor" : "none"} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    );
  }

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
