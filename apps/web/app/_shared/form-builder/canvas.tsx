"use client";

// The shared step/section/field canvas — used identically by the Super Admin's Platform Forms
// builder and the Tenant Admin's own Forms builder (Form Builder spec follow-up: "we should be
// using the same form builder as in the platform but working with respect to the tenant"). Each
// page computes its own `CanvasStep[]`/`CanvasSection[]` (including which actions are even
// available — a Tenant Admin can't edit a platform field's label, a Super Admin can't touch a
// tenant's own field) and hands the fully-resolved shape to this component, which only knows how
// to render it and report drag-reorder gestures back up — no domain logic (scope, ownership,
// permissions) lives here at all.
import { useState } from "react";
import { GripVertical } from "lucide-react";
import { Card, Badge } from "@tm/ui";
import { ActionMenu } from "./action-menu";
import type { CanvasField, CanvasSection, CanvasStep } from "./types";

function FieldRow({ field, onReorderDrop }: { field: CanvasField; onReorderDrop?: (draggedId: string) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const row = (
    <div
      draggable={field.draggable}
      onDragStart={(e) => {
        if (!field.draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", field.id);
      }}
      onDragOver={(e) => {
        if (!onReorderDrop) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!onReorderDrop) return;
        e.preventDefault();
        // Stops this from also bubbling into the section container's own onDrop below (which
        // would otherwise double-fire the reorder for the same gesture).
        e.stopPropagation();
        setDragOver(false);
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== field.id) onReorderDrop(draggedId);
      }}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${dragOver ? "border-cta bg-slate-50" : "border-border"} ${
        field.dimmed ? "opacity-50" : ""
      } ${field.onClick ? "cursor-pointer hover:bg-slate-50" : ""}`}
      onClick={field.onClick}
    >
      {field.draggable && <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-primary">
            {field.label}
            {field.isRequired && " *"}
          </p>
          {field.badges.map((badge, i) => (
            <Badge key={i} variant={badge.variant}>
              {badge.text}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-slate-400">{field.typeLabel}</p>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <ActionMenu actions={field.actions} />
      </div>
    </div>
  );
  return row;
}

export function SectionCard({ section, onReorderField }: { section: CanvasSection; onReorderField?: (draggedId: string, targetIndex: number) => void }) {
  const [containerDragOver, setContainerDragOver] = useState(false);
  return (
    <Card
      className="p-4"
      // The section itself (not just each field row) is a drop target — this is what lets a
      // field be dropped into an empty section, or dropped past the last row, and is the
      // mechanism a cross-section/cross-step drag ultimately relies on (Form Builder follow-up:
      // "we should be able to drag fields between steps"). A drop directly on a row is handled
      // (and stops propagating) there instead; this only fires for the section's own empty space.
      onDragOver={(e) => {
        if (!onReorderField) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setContainerDragOver(true);
      }}
      onDragLeave={() => setContainerDragOver(false)}
      onDrop={(e) => {
        if (!onReorderField) return;
        e.preventDefault();
        setContainerDragOver(false);
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId) onReorderField(draggedId, section.fields.length);
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className={`text-sm font-semibold ${section.emptyTitle ? "italic text-slate-400" : "text-primary"}`}>{section.title}</p>
        {section.actions && section.actions.length > 0 && (
          <div className="shrink-0">
            <ActionMenu actions={section.actions} size="sm" />
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {section.fields.length === 0 ? (
          <p className={`rounded-lg border border-dashed px-3 py-2 text-sm italic ${containerDragOver ? "border-cta bg-slate-50 text-secondary" : "border-transparent text-slate-400"}`}>
            No fields yet.
          </p>
        ) : (
          section.fields.map((field, index) => (
            <FieldRow key={field.id} field={field} onReorderDrop={onReorderField ? (draggedId) => onReorderField(draggedId, index) : undefined} />
          ))
        )}
      </div>
      {section.onAddField && (
        <button type="button" className="mt-3 cursor-pointer text-sm font-medium text-cta hover:underline" onClick={section.onAddField}>
          + Add field
        </button>
      )}
    </Card>
  );
}

export function FormBuilderCanvas({
  steps,
  noStepSections,
  onReorderField,
}: {
  steps: CanvasStep[];
  noStepSections: CanvasSection[];
  onReorderField?: (sectionKey: string, draggedId: string, targetIndex: number) => void;
}) {
  return (
    <div className="space-y-6">
      {steps.map((step, index) => (
        <div key={step.key}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary">
              Step {index + 1} — {step.title}
            </h2>
            {step.actions && step.actions.length > 0 && <ActionMenu actions={step.actions} size="sm" />}
          </div>
          <div className="space-y-4">
            {step.sections.map((section) => (
              <SectionCard key={section.key} section={section} onReorderField={onReorderField ? (draggedId, i) => onReorderField(section.key, draggedId, i) : undefined} />
            ))}
            {step.sections.length === 0 && step.onAddSection && (
              <Card className="p-4 text-center">
                <p className="text-sm italic text-slate-400">No sections yet.</p>
                <button type="button" className="mt-1 cursor-pointer text-sm font-medium text-cta hover:underline" onClick={step.onAddSection}>
                  + Add section
                </button>
              </Card>
            )}
          </div>
        </div>
      ))}

      {noStepSections.length > 0 && (
        <div className="space-y-4">
          {noStepSections.map((section) => (
            <SectionCard key={section.key} section={section} onReorderField={onReorderField ? (draggedId, i) => onReorderField(section.key, draggedId, i) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
