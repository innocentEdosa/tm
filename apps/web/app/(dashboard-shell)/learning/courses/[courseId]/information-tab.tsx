"use client";

import { useState } from "react";
import CourseDetailsPanel from "./course-details-panel";
import CourseObjectivesPanel from "./course-objectives-panel";
import CourseAuthorsPanel from "./course-authors-panel";

type Section = "details" | "objectives" | "authors";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "details", label: "Course Details" },
  { id: "objectives", label: "Course Objectives" },
  { id: "authors", label: "Course Authors" },
];

/** The Information top-tab: a left sub-nav for Course Details / Course Objectives / Course Authors. */
export default function InformationTab({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const [section, setSection] = useState<Section>("details");

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
        {section === "details" && <CourseDetailsPanel courseId={courseId} readOnly={readOnly} />}
        {section === "objectives" && <CourseObjectivesPanel courseId={courseId} readOnly={readOnly} />}
        {section === "authors" && <CourseAuthorsPanel courseId={courseId} readOnly={readOnly} />}
      </div>
    </div>
  );
}
