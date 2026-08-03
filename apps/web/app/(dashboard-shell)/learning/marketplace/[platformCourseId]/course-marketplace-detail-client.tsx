"use client";

// Course Marketplace spec (029), User Story 4/5 — tenant course detail + select/request action. Free
// courses clone immediately; paid courses create a pending request (contracts/course-marketplace-api.md).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button } from "@tm/ui";

const API_BASE = "/tenant-api/tenant";

interface ContentItem {
  id: string;
  type: string;
  title: string;
}

interface CourseModule {
  id: string;
  title: string;
  contentItems: ContentItem[];
}

interface PlatformCourseDetail {
  id: string;
  title: string;
  description: string | null;
  categoryName: string;
  deliveryMode: string;
  duration: { value: number; unit: string };
  cost: number | null;
  alreadySelected: boolean;
  selectionStatus: string | null;
  modules: CourseModule[];
}

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; data: PlatformCourseDetail };

export default function CourseMarketplaceDetailClient({
  subdomain,
  platformCourseId,
}: {
  subdomain: string;
  platformCourseId: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selectOutcome, setSelectOutcome] = useState<{ outcome: string; courseId?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    fetch(`${API_BASE}/course-marketplace/${platformCourseId}?${new URLSearchParams({ subdomain })}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (res.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as { data: PlatformCourseDetail };
        setState({ status: "ready", data: json.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [subdomain, platformCourseId, reloadToken]);

  async function select() {
    setSelecting(true);
    setSelectError(null);
    try {
      const res = await fetch(
        `${API_BASE}/course-marketplace/${platformCourseId}/select?${new URLSearchParams({ subdomain })}`,
        { method: "POST", credentials: "include" },
      );
      const json = (await res.json()) as { success: boolean; message?: string; data?: { outcome: string; courseId?: string } };
      if (!res.ok || !json.success) {
        setSelectError(json.message ?? "Couldn't complete this action. Try again.");
        return;
      }
      setSelectOutcome(json.data ?? null);
      setReloadToken((t) => t + 1);
    } catch {
      setSelectError("Couldn't reach the server. Try again.");
    } finally {
      setSelecting(false);
    }
  }

  if (state.status === "loading") {
    return <p className="mx-auto max-w-3xl text-sm text-slate-600">Loading…</p>;
  }
  if (state.status === "forbidden") {
    return (
      <div role="alert" className="banner-error mx-auto max-w-3xl">
        You don&apos;t have access to the course marketplace.
      </div>
    );
  }
  if (state.status === "not-found") {
    return (
      <div role="alert" className="banner-error mx-auto max-w-3xl">
        This course isn&apos;t available.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="banner-error mx-auto max-w-3xl">
        Couldn&apos;t load this course.
      </div>
    );
  }

  const course = state.data;
  const isPaid = !!course.cost;
  const isPending = course.selectionStatus === "requested";
  const isFulfilled = course.selectionStatus === "fulfilled" || course.alreadySelected;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/learning/marketplace" className="cursor-pointer text-sm text-cta hover:underline">
        ← Back to Course Marketplace
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">{course.title}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {course.categoryName} · {course.deliveryMode.replace("_", " ")} · {course.duration.value} {course.duration.unit} ·{" "}
            {isPaid ? `$${course.cost!.toFixed(2)}` : "Free"}
          </p>
          {course.description && <p className="mt-3 max-w-2xl text-sm text-slate-600">{course.description}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          {isFulfilled ? (
            <Badge variant="success">Added to your catalog</Badge>
          ) : isPending ? (
            <Badge variant="warning">Request pending</Badge>
          ) : (
            <Button type="button" onClick={select} isLoading={selecting}>
              {isPaid ? "Request Access" : "Select this course"}
            </Button>
          )}
        </div>
      </div>

      {selectError && (
        <div role="alert" className="banner-error mt-6">
          {selectError}
        </div>
      )}

      {selectOutcome?.outcome === "cloned" && selectOutcome.courseId && (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Added to your catalog. The course is now in your tenant&apos;s own course catalog, ready to
          assign.{" "}
          <Link href={`/learning/courses/${selectOutcome.courseId}`} className="font-medium underline">
            Open it
          </Link>
          .
        </div>
      )}
      {selectOutcome?.outcome === "requested" && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Your request has been sent. A TM admin will confirm payment before this course is added to your
          catalog.
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-primary">Curriculum</h2>
      {course.modules.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No curriculum published yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {course.modules.map((module) => (
            <div key={module.id} className="surface-card p-5">
              <h3 className="font-semibold text-text">{module.title}</h3>
              {module.contentItems.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No content items yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {module.contentItems.map((item) => (
                    <li key={item.id} className="flex items-center justify-between py-2">
                      <span className="text-sm font-medium text-text">{item.title}</span>
                      <span className="text-xs uppercase tracking-wide text-slate-500">{item.type.replace("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
