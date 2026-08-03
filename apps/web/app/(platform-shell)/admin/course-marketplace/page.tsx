"use client";

// Course Marketplace spec (029), User Story 1 — Super Admin platform-course list. Single-file Client
// Component, matching this shell's own established convention (tenants/page.tsx,
// admin/permissions/page.tsx) — the platform shell's layout already gates on a binary Super Admin
// session with no per-page permission variance to resolve server-side.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiResponse } from "@tm/types";
import { Badge, Button, Input } from "@tm/ui";
import { CourseEditorApiProvider } from "@/lib/course-editor-context";
import { platformCourseEditorApi } from "@/lib/course-editor-adapter";
import CreateCourseMenu from "@/app/(dashboard-shell)/learning/courses/create-course-menu";

const API_BASE = "/platform-api";

interface PlatformCourseRow {
  id: string;
  title: string;
  categoryName: string;
  deliveryMode: string;
  duration: { value: number; unit: string };
  cost: number | null;
  status: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; data: PlatformCourseRow[] };

function statusBadgeVariant(status: string): "success" | "accent" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "draft") return "neutral";
  return "warning";
}

export default function CourseMarketplaceAdminPage() {
  const api = useMemo(() => platformCourseEditorApi(), []);
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);

    fetch(`${API_BASE}/admin/platform-courses?${params}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthenticated" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as ApiResponse<PlatformCourseRow[]>;
        setState({ status: "ready", data: json.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [search, statusFilter]);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/platform/login");
    }
  }, [state.status, router]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Course Marketplace</h1>
          <p className="mt-2 text-sm text-slate-600">
            Courses you author here become available for every tenant to browse and select.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/course-marketplace/selections">
            <Button type="button" variant="outline">
              Pending Requests
            </Button>
          </Link>
          <CourseEditorApiProvider api={api}>
            <CreateCourseMenu editorBasePath="/admin/course-marketplace" />
          </CourseEditorApiProvider>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="field-input max-w-[160px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {(state.status === "loading" || state.status === "unauthenticated") && (
        <p className="mt-8 text-sm text-slate-600">Loading…</p>
      )}

      {state.status === "error" && (
        <div role="alert" className="banner-error mt-8">
          Couldn&apos;t load platform courses. Try again later.
        </div>
      )}

      {state.status === "ready" && (
        <>
          {state.data.length === 0 ? (
            <p className="mt-8 text-sm text-slate-600">
              {search || statusFilter ? "No courses match your filters." : "No platform courses yet."}
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Title
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Category
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Delivery
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Cost
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {state.data.map((course) => (
                    <tr key={course.id}>
                      <td className="px-4 py-3 font-medium text-text">{course.title}</td>
                      <td className="px-4 py-3 text-slate-600">{course.categoryName}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {course.deliveryMode.replace("_", " ")} · {course.duration.value} {course.duration.unit}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {course.cost ? `$${course.cost.toFixed(2)}` : "Free"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusBadgeVariant(course.status)}>{course.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/course-marketplace/${course.id}`}
                          className="cursor-pointer text-sm font-medium text-cta hover:underline"
                        >
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
