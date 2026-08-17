"use client";

import React, { useEffect } from "react";
import { ArrowLeft, X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Rendered immediately before the title text, inside the same header row — e.g. a small colored
   * icon badge identifying the modal's purpose at a glance. `title` itself stays a plain string
   * (still used verbatim as the dialog's `aria-label`) — this is purely a visual addition alongside
   * it, omitted by every other modal in this codebase today. */
  titleIcon?: React.ReactNode;
  /** When given, renders a back-arrow button before the title — for a modal that's one step in a
   * multi-step flow (e.g. `create-course-menu.tsx`'s type → method → AI-generation chain), letting the
   * caller return to whichever modal came before this one instead of closing the whole flow outright.
   * Omitted (the default) for a modal with no "previous step" to go back to. */
  onBack?: () => void;
  children: React.ReactNode;
  /** `"md"` (default) is the original fixed `max-w-md` panel. `"lg"` widens it to `max-w-3xl` for
   * content that needs more horizontal room, e.g. a multi-column option grid. */
  size?: "md" | "lg";
}

/**
 * Minimal reusable dialog primitive (research.md §6, Department Management spec 009) — the first
 * feature in this codebase needing an overlay/panel, so it's built once here rather than one-off
 * inside a single screen. Styled to the existing locked design system (`.surface-card`/`.btn`
 * classes), not a new visual language.
 */
export function Modal({ open, onClose, title, titleIcon, onBack, children, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`surface-card modal-panel ${size === "lg" ? "modal-panel-lg" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="flex items-center gap-4">
            {onBack && (
              <button
                type="button"
                aria-label="Back"
                onClick={onBack}
                className="flex shrink-0 cursor-pointer items-center justify-center text-primary transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
            )}
            <span className="flex items-center gap-2.5">
              {titleIcon}
              <h2 className="modal-title">{title}</h2>
            </span>
          </span>
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
