"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, RepeatableFieldList } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";

// Purely a starting suggestion for a blank course — neither list is required, and every row
// (including these initial ones) can be removed.
const INITIAL_OBJECTIVE_SLOTS = 3;

function seedObjectives(values: string[]): string[] {
  if (values.length >= INITIAL_OBJECTIVE_SLOTS) return values;
  return [...values, ...Array(INITIAL_OBJECTIVE_SLOTS - values.length).fill("")];
}

function seedRequirements(values: string[]): string[] {
  return values.length > 0 ? values : [""];
}

/**
 * Information > Course Objectives — Learning Objectives and Requirements/prerequisites, each an
 * optional add/remove-able list of short text fields via the shared `RepeatableFieldList` (`@tm/ui`).
 * Its own independent "Save Changes", separate from Course Details — `PATCH .../courses/:id/objectives`.
 */
export default function CourseObjectivesPanel({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const api = useCourseEditorApi();
  const queryClient = useQueryClient();

  const courseQuery = useQuery({
    queryKey: ["course", courseId, api.cacheScope],
    queryFn: () => api.fetchCourse(courseId),
  });
  const course = courseQuery.data;

  const [objectives, setObjectives] = useState<string[]>(seedObjectives(course?.learningObjectives ?? []));
  const [requirements, setRequirements] = useState<string[]>(seedRequirements(course?.requirements ?? []));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!course) return;
    setObjectives(seedObjectives(course.learningObjectives));
    setRequirements(seedRequirements(course.requirements));
    // Only re-sync on initial load / a genuinely different course — not after every save's refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  if (!course) {
    return courseQuery.isError ? <p className="banner-error">Couldn&apos;t load this course. Try refreshing.</p> : <p className="text-sm text-muted">Loading…</p>;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    setSaving(true);
    try {
      await api.updateObjectives(courseId, { learningObjectives: objectives, requirements });
      await queryClient.invalidateQueries({ queryKey: ["course", courseId, api.cacheScope] });
      setError(null);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">Course Objectives</h2>

      {error && <p className="banner-error mt-4">{error}</p>}
      {saved && !error && <p className="mt-4 text-sm text-success">Saved.</p>}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-8">
        <fieldset disabled={readOnly} className="flex flex-col gap-8">
          <div>
            <h3 className="font-semibold text-primary">Learning Objectives</h3>
            <p className="mb-4 text-sm text-muted">
              Add the learning objectives or outcomes that learners can anticipate achieving upon finishing the course.
            </p>
            <RepeatableFieldList
              items={objectives}
              onChange={setObjectives}
              itemPlaceholder={(i) => `Objective ${i + 1}`}
              addLabel="Add Objective"
              readOnly={readOnly}
            />
          </div>

          <div>
            <h3 className="font-semibold text-primary">Requirements and prerequisites</h3>
            <p className="mb-4 text-sm text-muted">
              List the necessary prerequisites for learners such as skills, experience, or tools that are essential to have before taking your
              course.
            </p>
            <RepeatableFieldList
              items={requirements}
              onChange={setRequirements}
              itemPlaceholder={(i) => `Requirement/ prerequisite ${i + 1}`}
              addLabel="Add Requirements"
              readOnly={readOnly}
            />
          </div>
        </fieldset>

        {!readOnly && (
          <div>
            <Button type="submit" variant="secondary" isLoading={saving}>
              Save Changes
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
