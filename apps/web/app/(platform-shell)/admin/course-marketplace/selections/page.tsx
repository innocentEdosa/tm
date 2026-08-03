"use client";

// Course Marketplace spec (029), User Story 5 — Super Admin cross-tenant pending paid-selection
// queue. Single-file Client Component, matching this shell's own established convention.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiResponse } from "@tm/types";
import { Button } from "@tm/ui";

const API_BASE = "/platform-api";

interface SelectionRow {
  id: string;
  tenantId: string;
  tenantName: string;
  platformCourseId: string;
  platformCourseTitle: string;
  status: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; data: SelectionRow[] };

export default function PendingSelectionsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    fetch(`${API_BASE}/admin/marketplace-selections?status=requested`, { credentials: "include", cache: "no-store" })
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
        const json = (await res.json()) as ApiResponse<SelectionRow[]>;
        setState({ status: "ready", data: json.data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/platform/login");
    }
  }, [state.status, router]);

  async function resolve(selectionId: string, decision: "paid" | "rejected") {
    setActioningId(selectionId);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/marketplace-selections/${selectionId}/resolve`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || !json.success) {
        setActionError(json.message ?? "Couldn't resolve this request. Try again.");
        return;
      }
      reload();
    } catch {
      setActionError("Couldn't reach the server. Try again.");
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/course-marketplace" className="cursor-pointer text-sm text-cta hover:underline">
        ← Back to Course Marketplace
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight text-primary">Pending Requests</h1>
      <p className="mt-2 text-sm text-slate-600">
        Paid course selections awaiting payment confirmation, across every tenant.
      </p>

      {(state.status === "loading" || state.status === "unauthenticated") && (
        <p className="mt-8 text-sm text-slate-600">Loading…</p>
      )}

      {state.status === "error" && (
        <div role="alert" className="banner-error mt-8">
          Couldn&apos;t load pending requests.
        </div>
      )}

      {actionError && (
        <div role="alert" className="banner-error mt-6">
          {actionError}
        </div>
      )}

      {state.status === "ready" && (
        <>
          {state.data.length === 0 ? (
            <p className="mt-8 text-sm text-slate-600">No pending requests.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {state.data.map((selection) => (
                <div key={selection.id} className="surface-card flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-text">{selection.platformCourseTitle}</p>
                    <p className="text-sm text-slate-600">
                      Requested by {selection.requestedByName} for {selection.tenantName}
                    </p>
                    <p className="text-xs text-slate-500">{new Date(selection.requestedAt).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      isLoading={actioningId === selection.id}
                      onClick={() => resolve(selection.id, "rejected")}
                    >
                      Reject
                    </Button>
                    <Button type="button" isLoading={actioningId === selection.id} onClick={() => resolve(selection.id, "paid")}>
                      Mark Paid
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
