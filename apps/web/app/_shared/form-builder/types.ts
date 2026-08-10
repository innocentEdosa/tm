import type { ComponentType } from "react";
import type { BadgeProps } from "@tm/ui";

export interface CanvasAction {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick: () => void;
  destructive?: boolean;
}

export interface CanvasBadge {
  text: string;
  variant: NonNullable<BadgeProps["variant"]>;
}

export interface CanvasField {
  id: string;
  label: string;
  isRequired: boolean;
  typeLabel: string;
  badges: CanvasBadge[];
  dimmed?: boolean;
  actions: CanvasAction[];
  /** Falls back to opening the actions menu when omitted — set for the "click anywhere on the
   * row" pattern (e.g. a single, always-available "Edit"). */
  onClick?: () => void;
  draggable?: boolean;
}

export interface CanvasSection {
  key: string;
  title: string;
  emptyTitle?: boolean;
  fields: CanvasField[];
  actions?: CanvasAction[];
  onAddField?: () => void;
}

export interface CanvasStep {
  key: string;
  title: string;
  sections: CanvasSection[];
  actions?: CanvasAction[];
  /** A freshly-created step has zero sections — without this, it's a dead end (nothing renders
   * below its header, no way to reach "add a field to this step" at all). Set to show a "No
   * sections yet — + Add section" prompt in that case. */
  onAddSection?: () => void;
}
