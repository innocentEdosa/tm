"use client";

import { useState } from "react";
import CurriculumTab from "./curriculum-tab";

type Section = "outline";

const SECTIONS: { id: Section; label: string }[] = [{ id: "outline", label: "Course Outline" }];

/**
 * The Curriculum top-tab: a left sub-nav for "Course Outline" (the module/lesson editor). File
 * Manager was removed from here — file reuse now happens inline, via drawers opened where a file is
 * actually needed (e.g. the course-image picker's "Choose an existing image" drawer,
 * course-image-field.tsx, and the lesson-resource picker, content-item-forms/lesson-form-sections.tsx)
 * rather than a separate standalone section here.
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
      <div className="flex-1">{section === "outline" && <CurriculumTab courseId={courseId} readOnly={readOnly} />}</div>
    </div>
  );
}
