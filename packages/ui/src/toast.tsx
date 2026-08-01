"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type ToastVariant = "success" | "error";

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onDismiss: () => void;
  /** Milliseconds before auto-dismissing. */
  duration?: number;
}

const DEFAULT_DURATION_MS = 4000;
// Must match the transition-duration class below — `close()` waits this long before telling the
// parent to actually unmount, so the exit transition finishes playing instead of getting cut off.
const EXIT_ANIMATION_MS = 200;

/**
 * A transient, corner-positioned notification for the outcome of an action (typically an API
 * call) — success or error, self-dismissing after `duration`. Reuses the same
 * `.banner-success`/`.banner-error` classes every inline status banner in this app already uses,
 * so a toast reads as the same visual language, just temporary and out-of-flow. Portaled to
 * `document.body` so no ancestor's `overflow-hidden`/stacking context can clip or bury it.
 *
 * Animates in on mount and out before actually calling `onDismiss` — the parent conditionally
 * renders this component (`{toast && <Toast .../>}`), which would otherwise unmount it instantly
 * with no chance to play an exit transition, so `close()` delays the real `onDismiss` call by
 * `EXIT_ANIMATION_MS` and lets the CSS transition run first.
 */
export function Toast({ message, variant = "success", onDismiss, duration = DEFAULT_DURATION_MS }: ToastProps) {
  const [visible, setVisible] = useState(false);

  // Mounts off-screen/transparent, then flips to its resting state a frame later so the browser
  // actually paints the "before" state first — flipping in the same tick as the initial render
  // would just snap straight to visible with nothing to transition from. The double rAF ensures a
  // full paint has happened between the two.
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  function close() {
    setVisible(false);
    setTimeout(onDismiss, EXIT_ANIMATION_MS);
  }

  useEffect(() => {
    const timer = setTimeout(close, duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, duration]);

  return createPortal(
    <div
      className={`fixed right-6 bottom-6 z-50 max-w-sm transition-all duration-200 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <div className={`${variant === "success" ? "banner-success" : "banner-error"} shadow-card-lg flex items-start gap-3`}>
        <span className="flex-1">{message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          className="cursor-pointer text-lg leading-none opacity-60 hover:opacity-100"
          onClick={close}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
