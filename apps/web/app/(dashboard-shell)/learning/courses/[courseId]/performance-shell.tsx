"use client";

import { useState } from "react";
import LearnersTab from "./learners-tab";
import ReviewsTab from "./reviews-tab";

type Section = "learners" | "reviews";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "learners", label: "Learners" },
  { id: "reviews", label: "Reviews" },
];

/**
 * The Performance top-tab: a left sub-nav mirroring `CurriculumShell`'s own pattern. "Learners" (the
 * reference product's own "Subscribers", renamed per spec) lists every learner enrolled in the course
 * and how far through it they are; "Reviews" covers ratings/feedback.
 */
export default function PerformanceShell({
  courseId,
  courseName,
  readOnly,
  currentUserEmail,
}: {
  courseId: string;
  courseName: string;
  readOnly: boolean;
  currentUserEmail: string;
}) {
  const [section, setSection] = useState<Section>("learners");

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
        {section === "learners" && <LearnersTab courseId={courseId} courseName={courseName} />}
        {section === "reviews" && <ReviewsTab courseId={courseId} readOnly={readOnly} currentUserEmail={currentUserEmail} />}
      </div>
    </div>
  );
}
