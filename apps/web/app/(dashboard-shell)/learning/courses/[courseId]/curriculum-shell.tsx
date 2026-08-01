"use client";

import { useState } from "react";
import { Card } from "@tm/ui";
import CurriculumTab from "./curriculum-tab";

type Section = "outline" | "files";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "outline", label: "Course Outline" },
  { id: "files", label: "File Manager" },
];

/**
 * The Curriculum top-tab: a left sub-nav for "Course Outline" (the module/lesson editor) and "File
 * Manager" — a browser for files already uploaded elsewhere in the tenant, so a lesson can reuse one
 * instead of re-uploading. File Manager is a stub for now; its real API wiring is a later spec.
 */
export default function CurriculumShell({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const [section, setSection] = useState<Section>("outline");

  return (
    <div className="flex gap-8">
      <nav className="w-56 shrink-0">
        <ul className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium ${
                  section === s.id ? "bg-slate-100 text-primary" : "text-secondary hover:bg-slate-50"
                }`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1">
        {section === "outline" && <CurriculumTab courseId={courseId} readOnly={readOnly} />}
        {section === "files" && (
          <Card>
            <p className="font-semibold">File Manager</p>
            <p className="text-sm text-muted">
              Reuse files already uploaded elsewhere in your tenant instead of uploading them again. This section is coming soon.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
