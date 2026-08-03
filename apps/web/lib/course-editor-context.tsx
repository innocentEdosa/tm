"use client";

import { createContext, useContext } from "react";
import type { CourseEditorApi } from "@/lib/course-editor-adapter";

/**
 * Same rationale as `subdomain-context.tsx` (deep tree, most leaves need it) — carries the
 * save-target adapter (`tenantCourseEditorApi`/`platformCourseEditorApi`) so the course editor UI
 * (`information-tab.tsx`, `curriculum-shell.tsx`, and everything under them) can be reused unmodified
 * for both tenant course authoring and Super Admin platform-course authoring.
 */
const CourseEditorApiContext = createContext<CourseEditorApi | null>(null);

export function CourseEditorApiProvider({ api, children }: { api: CourseEditorApi; children: React.ReactNode }) {
  return <CourseEditorApiContext.Provider value={api}>{children}</CourseEditorApiContext.Provider>;
}

export function useCourseEditorApi(): CourseEditorApi {
  const api = useContext(CourseEditorApiContext);
  if (api === null) {
    throw new Error("useCourseEditorApi must be used within a CourseEditorApiProvider");
  }
  return api;
}
