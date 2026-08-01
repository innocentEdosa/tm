"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

export interface PopoverProps {
  /** The element that opens the popover on click. */
  trigger: React.ReactNode;
  /** Panel content. Receives `close` so items can dismiss the popover after acting. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Panel width in px. */
  width?: number;
  /** Which edge of the trigger the panel's corresponding edge aligns to. */
  align?: "start" | "end";
  className?: string;
  /** Controlled open state — e.g. so a parent can open this popover from a trigger other than its
   * own (auto-opening a module's content-type picker after "Lesson" is picked from a different
   * menu). Omit both `open` and `onOpenChange` for the default uncontrolled (click-to-toggle)
   * behavior. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Generic anchored, portal-based popover (trigger + click-outside-to-close panel) — the same
 * position/portal/click-outside mechanics already used ad hoc for row-action menus, generalized so any
 * screen can open a floating panel off a trigger element without re-deriving this logic.
 */
export function Popover({ trigger, children, width = 320, align = "end", className = "", open: controlledOpen, onOpenChange }: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  }

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target;
      // `closest("[data-popover]")` rather than ref-containment against just this popover's own
      // anchor/panel — a click inside ANY popover-marked element (e.g. a manually-portaled flyout a
      // caller nests beside this one, tagged with the same `data-popover` attribute) must not count
      // as "outside" either, or a cascading submenu's own item clicks would close this one first.
      if (target instanceof Element && target.closest("[data-popover]")) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Recomputed off `open` itself (not just the trigger's own click) so a controlled open — set
  // programmatically by a parent — still positions the panel against this popover's anchor.
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const left = align === "end" ? rect.right - width : rect.left;
    setPosition({ top: rect.bottom + 8, left });
  }, [open, align, width]);

  function toggleOpen() {
    setOpen(!open);
  }

  function close() {
    setOpen(false);
  }

  return (
    <span data-popover className="inline-block">
      <span ref={anchorRef} className="inline-block cursor-pointer" onClick={toggleOpen}>
        {trigger}
      </span>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            data-popover
            style={{ top: position.top, left: position.left, width }}
            className={`fixed z-50 divide-y divide-border overflow-hidden rounded-lg border border-border bg-white shadow-card-md ${className}`.trim()}
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )}
    </span>
  );
}

export interface PopoverMenuItemProps {
  icon: React.ReactNode;
  title: string;
  /** Omit for a compact single-line icon+label row (e.g. a plain "Add" menu); include for the
   * larger icon+title+subtitle row (e.g. an entry-point choice). */
  subtitle?: string;
  /** Larger padding + visual emphasis for a top "hero" option. */
  hero?: boolean;
  showChevron?: boolean;
  onClick: () => void;
}

/** A single option row for use inside a `Popover` — icon+title, or icon+title+subtitle when
 * `subtitle` is given. */
export function PopoverMenuItem({ icon, title, subtitle, hero = false, showChevron = false, onClick }: PopoverMenuItemProps) {
  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-center gap-3 text-left hover:bg-slate-50 ${subtitle ? "items-start px-4 py-3" : "px-3 py-2"} ${hero ? "py-4" : ""}`}
      onClick={onClick}
    >
      <span className={`flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-secondary ${subtitle ? "h-9 w-9" : "h-7 w-7"}`}>{icon}</span>
      <span className="flex-1">
        <span className={`block text-primary ${subtitle ? "font-semibold" : "text-sm font-medium"}`}>{title}</span>
        {subtitle && <span className="block text-sm text-muted">{subtitle}</span>}
      </span>
      {showChevron && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-secondary" />}
    </button>
  );
}
