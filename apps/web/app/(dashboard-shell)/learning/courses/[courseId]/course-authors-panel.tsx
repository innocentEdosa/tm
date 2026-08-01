"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button, Modal } from "@tm/ui";
import { tenantFetch } from "@/lib/tenant-api-client";
import { useSubdomain } from "@/lib/subdomain-context";
import type { CourseAuthor } from "@/lib/course-api-types";
import AddAuthorDrawer from "./add-author-drawer";

function AuthorAvatar({ author }: { author: CourseAuthor }) {
  if (author.profileImageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- remote/presigned URL, no next/image domain config for it
    return <img src={author.profileImageUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return <span className="shell-profile-avatar">{author.name.charAt(0).toUpperCase()}</span>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Information > Course Authors — lists instructors/contributors credited on the course, with an
 * "Add Author" drawer and per-row delete.
 */
export default function CourseAuthorsPanel({ courseId, readOnly }: { courseId: string; readOnly: boolean }) {
  const subdomain = useSubdomain();
  const queryClient = useQueryClient();

  const authorsQuery = useQuery({
    queryKey: ["course-authors", courseId, subdomain],
    queryFn: async () => {
      const { data } = await tenantFetch<{ data: CourseAuthor[] }>(`/courses/${courseId}/authors`, { subdomain });
      return data;
    },
  });
  const authors = authorsQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (authorId: string) => tenantFetch(`/course-authors/${authorId}`, { method: "DELETE", subdomain }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["course-authors", courseId, subdomain] }),
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [manageAccessOpen, setManageAccessOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CourseAuthor | null>(null);

  return (
    <div>
      <div className="mb-1 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-primary">Course Authors</h2>
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs font-medium text-secondary">
            {authors.length}
          </span>
        </div>
        {!readOnly && <Button onClick={() => setDrawerOpen(true)}>Add Author</Button>}
      </div>
      <p className="mb-6 text-sm text-muted">Add instructors and contributors who should be credited on this course.</p>

      {authorsQuery.isError ? (
        <p className="banner-error">Couldn&apos;t load authors. Try refreshing.</p>
      ) : authors.length === 0 ? (
        <p className="text-sm text-muted">No authors added yet.</p>
      ) : (
        <table className="w-full table-fixed divide-y divide-border text-sm">
          <colgroup>
            <col className="w-[44%]" />
            <col className="w-[18%]" />
            <col className="w-[24%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Authors</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Added</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600"></th>
              <th className="px-4 py-2 text-right font-medium text-slate-600"></th>
            </tr>
          </thead>
          <tbody>
            {authors.map((author) => (
              <tr key={author.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <AuthorAvatar author={author} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-primary">{author.name}</p>
                      <p className="truncate text-sm text-muted">{author.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-secondary">{formatDate(author.createdAt)}</td>
                <td className="px-4 py-3">
                  <button type="button" className="cursor-pointer text-secondary hover:text-primary hover:underline" onClick={() => setManageAccessOpen(true)}>
                    Manage Access
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Remove ${author.name}`}
                      className="cursor-pointer rounded-lg p-2 text-secondary hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleteTarget(author)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AddAuthorDrawer courseId={courseId} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <Modal open={manageAccessOpen} onClose={() => setManageAccessOpen(false)} title="Coming soon">
        <p className="text-sm text-secondary">Managing an author&apos;s access isn&apos;t available yet.</p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setManageAccessOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={`Remove "${deleteTarget?.name ?? ""}"?`}>
        <div className="space-y-4">
          <p className="text-sm text-secondary">This can&apos;t be undone. Are you sure you want to remove this author from the course?</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
              isLoading={deleteMutation.isPending}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
