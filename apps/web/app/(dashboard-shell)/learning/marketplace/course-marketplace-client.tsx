"use client";

// Course Marketplace spec (029), User Story 3 — tenant browse/search/filter list of active platform
// courses. Matches this shell's own established server-page/client-component split
// (department-settings-client.tsx).
import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Badge, Input, PageHeader } from "@tm/ui";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";

const API_BASE = "/tenant-api/tenant";

interface PlatformCourseSummary {
  id: string;
  title: string;
  description: string | null;
  categoryName: string;
  deliveryMode: string;
  duration: { value: number; unit: string };
  cost: number | null;
  courseImageUrl: string | null;
  alreadySelected: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; data: PlatformCourseSummary[] };

export default function CourseMarketplaceClient({ subdomain }: { subdomain: string }) {
  const [search, setSearch] = useState("");
  const [costFilter, setCostFilter] = useState("");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    const params = new URLSearchParams({ subdomain });
    if (search) params.set("search", search);
    if (costFilter) params.set("cost", costFilter);

    fetch(`${API_BASE}/course-marketplace?${params}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as { data: PlatformCourseSummary[] };
        setState({ status: "ready", data: json.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [subdomain, search, costFilter]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Course Marketplace"
        subtitle="Browse courses published by TM and add them to your own catalog."
      />

      <div className="mt-6 flex flex-wrap gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="field-input max-w-[160px]" value={costFilter} onChange={(e) => setCostFilter(e.target.value)}>
          <option value="">All courses</option>
          <option value="free">Free only</option>
          <option value="paid">Paid only</option>
        </select>
      </div>

      {state.status === "loading" && <p className="mt-8 text-sm text-slate-600">Loading…</p>}

      {state.status === "forbidden" && (
        <div role="alert" className="banner-error mt-8">
          You don&apos;t have access to the course marketplace.
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" className="banner-error mt-8">
          Couldn&apos;t load the marketplace. Try again later.
        </div>
      )}

      {state.status === "ready" && (
        <>
          {state.data.length === 0 ? (
            <p className="mt-8 text-sm text-slate-600">
              {search || costFilter ? "No courses match your filters." : "Nothing published in the marketplace yet."}
            </p>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.data.map((course) => (
                <Link
                  key={course.id}
                  href={`/learning/marketplace/${course.id}`}
                  className="surface-card block cursor-pointer overflow-hidden p-0 transition hover:-translate-y-0.5"
                >
                  <div className="aspect-video w-full shrink-0 overflow-hidden bg-slate-100">
                    {course.courseImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, no next/image domain config for it
                      <img src={course.courseImageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-300">
                        <BookOpen className="h-10 w-10" />
                      </div>
                    )}
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-text">{course.title}</h3>
                      {course.alreadySelected && <Badge variant="success">Added</Badge>}
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{course.categoryName}</p>
                    {course.description && (
                      <div
                        className="rich-text-content mt-2 line-clamp-2 text-sm text-slate-600"
                        dangerouslySetInnerHTML={{ __html: sanitizeRichText(course.description) }}
                      />
                    )}
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        {course.deliveryMode.replace("_", " ")} · {course.duration.value} {course.duration.unit}
                      </span>
                      <span className="font-medium text-cta">{course.cost ? `$${course.cost.toFixed(2)}` : "Free"}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
