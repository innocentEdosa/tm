"use client";

import { useState } from "react";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import CourseDetailsPanel from "./course-details-panel";
import CourseObjectivesPanel from "./course-objectives-panel";
import CourseAuthorsPanel from "./course-authors-panel";

type Section = "details" | "objectives" | "authors";

/** The Information top-tab: a left sub-nav for Course Details / Course Objectives / Course Authors —
 * "Course Authors" is omitted when `api.supportsAuthors` is false (platform courses have no
 * equivalent concept, spec 029 UI-reuse follow-up). */
export default function InformationTab({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const api = useCourseEditorApi();
  const [section, setSection] = useState<Section>("details");
  const sections: { id: Section; label: string }[] = [
    { id: "details", label: "Course Details" },
    { id: "objectives", label: "Course Objectives" },
    ...(api.supportsAuthors ? [{ id: "authors" as const, label: "Course Authors" }] : []),
  ];

  return (
    <div className="flex gap-8">
      <nav className="w-56 shrink-0">
        <ul className="flex flex-col gap-1">
          {sections.map((s) => (
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
        {section === "authors" && api.supportsAuthors && <CourseAuthorsPanel courseId={courseId} readOnly={readOnly} />}
      </div>
    </div>
  );
}
