"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
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
export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
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
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
