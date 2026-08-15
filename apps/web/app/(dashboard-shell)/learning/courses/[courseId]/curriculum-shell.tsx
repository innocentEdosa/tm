"use client";

import CurriculumTab from "./curriculum-tab";

/**
 * The Curriculum top-tab. Used to be a left sub-nav wrapping "Course Outline" (the module/lesson
 * editor) alongside a File Manager section; File Manager was removed (file reuse now happens inline,
 * via drawers opened where a file is actually needed — the course-image picker's "Choose an existing
 * image" drawer, course-image-field.tsx, and the lesson-resource picker,
 * content-item-forms/lesson-form-sections.tsx), which left the nav with a single, permanently-active
 * entry pointing nowhere else — removed rather than kept as a no-op affordance.
 */
export default function CurriculumShell({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  return <CurriculumTab courseId={courseId} readOnly={readOnly} />;
}
