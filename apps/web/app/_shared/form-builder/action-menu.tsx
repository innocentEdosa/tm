"use client";

// A generic "..." actions menu — shared by both the Platform and Tenant form builders, for every
// row that can have more than one contextual action (a field, a section, a step). Deliberately
// knows nothing about *what* the actions are (field vs. section vs. step, system vs. tenant) —
// each caller computes its own list of `CanvasAction`s according to its own capability rules.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import type { CanvasAction } from "./types";

const MENU_WIDTH = 170;
const MENU_ITEM_HEIGHT = 36;

export function ActionMenu({ actions, size = "md" }: { actions: CanvasAction[]; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current && !buttonRef.current.contains(target) && menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuHeight = actions.length * MENU_ITEM_HEIGHT + 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < menuHeight ? rect.top - menuHeight : rect.bottom + 4;
      const left = rect.right - MENU_WIDTH;
      setPosition({ top, left });
    }
    setOpen((prev) => !prev);
  }

  if (actions.length === 0) return null;

  const buttonSize = size === "sm" ? "h-7 w-7" : "h-8 w-8";

  return (
    <div data-action-menu>
      <button
        ref={buttonRef}
        type="button"
        className={`flex ${buttonSize} shrink-0 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-50 hover:text-primary`}
        aria-label="Actions"
        onClick={toggleOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            data-action-menu
            style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
            className="fixed z-50 rounded-lg border border-border bg-white py-1 shadow-card-md"
          >
            {actions.map((action, index) => (
              <button
                key={index}
                type="button"
                className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  action.destructive ? "text-red-600 hover:bg-red-50" : "text-secondary hover:text-primary"
                }`}
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
              >
                {action.icon && <action.icon className="h-3.5 w-3.5" />}
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
