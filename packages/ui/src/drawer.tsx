"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

export type DrawerSide = "left" | "right" | "top" | "bottom";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: DrawerSide;
  children: React.ReactNode;
}

/**
 * Reusable slide-in panel primitive, sibling to `Modal` — same overlay/close-on-outside-click/
 * Escape-to-close behavior, but the panel slides in from a chosen edge instead of appearing
 * centered. First consumer: the Department create/edit form (right side), per its own feedback
 * that a full-height side panel suits a longer form better than a centered dialog.
 */
export function Drawer({ open, onClose, title, side = "right", children }: DrawerProps) {
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
    <div className="drawer-overlay" onClick={onClose}>
      <div
        className="drawer-panel"
        data-side={side}
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
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
