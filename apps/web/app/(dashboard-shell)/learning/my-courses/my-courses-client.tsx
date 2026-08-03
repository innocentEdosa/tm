"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { PageHeader } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { SubdomainProvider, useSubdomain } from "@/lib/subdomain-context";
import type { Course } from "@/lib/course-api-types";
import { fetchCourseCardData } from "./fetch-course-card-data";
import type { CourseCardData, UpcomingLearningItem } from "./types";
import CourseCard from "./course-card";
import UpcomingLearningsPanel from "./upcoming-learnings-panel";

type SortOption = "newest" | "oldest" | "title" | "progress";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "Title (A–Z)" },
  { value: "progress", label: "Progress (High to Low)" },
];

function sortCards(cards: CourseCardData[], sortBy: SortOption): CourseCardData[] {
  const sorted = [...cards];
  switch (sortBy) {
    case "newest":
      return sorted.sort((a, b) => new Date(b.course.createdAt).getTime() - new Date(a.course.createdAt).getTime());
    case "oldest":
      return sorted.sort((a, b) => new Date(a.course.createdAt).getTime() - new Date(b.course.createdAt).getTime());
    case "title":
      return sorted.sort((a, b) => a.course.title.localeCompare(b.course.title));
    case "progress":
      return sorted.sort((a, b) => b.percent - a.percent);
  }
}

function MyCoursesInner() {
  const subdomain = useSubdomain();
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [searchQuery, setSearchQuery] = useState("");

  // Already assignment-filtered server-side (course_assignments) — this is "my courses" with no
  // extra filtering needed here. `status=active` excludes courses still in draft/archived, which a
  // learner shouldn't see regardless of assignment.
  const coursesQuery = useQuery({
    queryKey: ["my-courses", subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: Course[] }>(`/courses?status=active&pageSize=100`, { subdomain });
      return data;
    },
  });
  const courses = coursesQuery.data ?? [];

  const cardQueries = useQueries({
    queries: courses.map((course) => ({
      queryKey: ["my-course-card", course.id, subdomain],
      queryFn: () => fetchCourseCardData(course, subdomain),
    })),
  });
  const cardsStillLoading = courses.length > 0 && cardQueries.some((q) => q.isLoading);
  const someCardsFailed = cardQueries.some((q) => q.isError);
  const cardData = cardQueries.map((q) => q.data).filter((d): d is CourseCardData => !!d);

  const categories = useMemo(() => {
    const names = new Set(courses.map((c) => c.category?.name).filter((n): n is string => !!n));
    return Array.from(names).sort();
  }, [courses]);

  const visibleCards = useMemo(() => {
    const trimmedSearch = searchQuery.trim().toLowerCase();
    const filtered = cardData.filter((c) => {
      const matchesCategory = !selectedCategory || c.course.category?.name === selectedCategory;
      const matchesSearch = !trimmedSearch || c.course.title.toLowerCase().includes(trimmedSearch);
      return matchesCategory && matchesSearch;
    });
    return sortCards(filtered, sortBy);
  }, [cardData, selectedCategory, searchQuery, sortBy]);

  const upcomingLiveClasses: UpcomingLearningItem[] = useMemo(() => {
    const now = Date.now();
    return cardData
      .flatMap((c) => c.liveClasses)
      .filter((lc) => !!lc.scheduledAt && new Date(lc.scheduledAt).getTime() > now)
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
  }, [cardData]);

  const suggestion: UpcomingLearningItem | null = useMemo(() => {
    const inProgress = cardData.filter((c) => c.status === "in_progress" && c.nextItem);
    if (inProgress.length === 0) return null;
    const mostRecentlyActive = [...inProgress].sort((a, b) => {
      const at = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bt = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bt - at;
    })[0];
    if (!mostRecentlyActive.nextItem) return null;
    return {
      courseId: mostRecentlyActive.course.id,
      courseTitle: mostRecentlyActive.course.title,
      courseImageUrl: mostRecentlyActive.course.courseImageUrl,
      contentItemId: mostRecentlyActive.nextItem.contentItemId,
      title: mostRecentlyActive.nextItem.title,
      authorName: mostRecentlyActive.teacherName,
      authorAvatarUrl: mostRecentlyActive.teacherAvatarUrl,
    };
  }, [cardData]);

  // Clicking a course means "go learn from it" — opens the learning-area player (video/curriculum
  // sidebar) in a new tab, deep-linked to whichever lesson is next up when known, rather than
  // navigating this tab away from the course list.
  function goToCourse(courseId: string, contentItemId?: string) {
    const url = contentItemId ? `/learning/play/${courseId}?item=${encodeURIComponent(contentItemId)}` : `/learning/play/${courseId}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (coursesQuery.isError) {
    return (
      <main className="px-8 py-8">
        <p className="banner-error">Couldn&apos;t load your courses. Try refreshing.</p>
      </main>
    );
  }

  if (coursesQuery.isLoading) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center px-8 py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-300 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="px-8 py-8">
      <PageHeader title="My Courses" />

      {courses.length > 0 && (
        // No `items-start` — left as flexbox's default `stretch` so the (naturally much shorter)
        // filter column and the Upcoming Learnings panel share the same height, keeping their
        // bottom edges aligned regardless of how many items the panel ends up rendering.
        <div className="flex flex-col gap-6 border-b border-border pb-6 lg:flex-row lg:justify-between">
          <div className="flex flex-col gap-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                className="field-input pl-9"
                placeholder="Search courses…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <div>
                <label className="field-label" htmlFor="my-courses-category">
                  Category
                </label>
                <select
                  id="my-courses-category"
                  className="field-input"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="">All Courses</option>
                  {categories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="my-courses-sort">
                  Sort
                </label>
                <select
                  id="my-courses-sort"
                  className="field-input"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-96 lg:shrink-0">
            <UpcomingLearningsPanel liveClasses={upcomingLiveClasses} suggestion={suggestion} onSelectCourse={goToCourse} />
          </div>
        </div>
      )}

      {someCardsFailed && <p className="banner-error mt-4">Some of your courses couldn&apos;t be loaded. Try refreshing.</p>}

      {courses.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-white p-12 text-center">
          <p className="text-secondary">No courses have been assigned to you yet.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCards.map((data) => (
            <CourseCard key={data.course.id} data={data} onSelect={() => goToCourse(data.course.id, data.nextItem?.contentItemId)} />
          ))}
          {cardsStillLoading &&
            visibleCards.length === 0 &&
            Array.from({ length: Math.min(3, courses.length) }).map((_, i) => (
              <div key={i} className="h-80 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          {!cardsStillLoading && visibleCards.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted">No courses match your search or filters.</p>
          )}
        </div>
      )}
    </main>
  );
}

export default function MyCoursesClient({ subdomain }: { subdomain: string }) {
  return (
    <SubdomainProvider subdomain={subdomain}>
      <MyCoursesInner />
    </SubdomainProvider>
  );
}
