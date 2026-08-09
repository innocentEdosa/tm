"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { ChevronLeft, ChevronRight, File as FileIcon } from "lucide-react";
import { Button, Badge, Drawer } from "@tm/ui";
import { useCourseEditorApi } from "@/lib/course-editor-context";
import type { TenantFile } from "@/lib/course-api-types";
import { formatFileSize, formatFileType, formatDate } from "@/lib/file-format";

const PAGE_SIZE = 8;

/**
 * Shared "choose an existing tenant file" drawer — one fetch/filter/pagination/row implementation
 * used by both the course-image picker (course-image-field.tsx, `allowedContentTypes:
 * IMAGE_CONTENT_TYPES`) and the lesson-resource picker (content-item-forms/lesson-form-sections.tsx,
 * `CONTENT_ITEM_RESOURCE_CONTENT_TYPES`) rather than each maintaining its own near-identical copy.
 * Every file (`GET /tenant/files`, tenant-wide, regardless of which section originally uploaded it)
 * whose `contentType` is in `allowedContentTypes` is shown — reusing one is entirely the caller's
 * concern (`onUse`), since the two contexts reuse through different endpoints
 * (`.../image/reuse` vs. `.../attachments/reuse`).
 */
export default function ExistingFilePicker({
  open,
  onClose,
  title,
  allowedContentTypes,
  onUse,
  usingId,
  error,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  allowedContentTypes: string[];
  onUse: (file: TenantFile) => void;
  usingId: string | null;
  error?: string | null;
}) {
  const api = useCourseEditorApi();
  const [page, setPage] = useState(0);

  const filesQuery = useQuery({
    queryKey: ["tenant-files", api.cacheScope],
    queryFn: () => api.fetchTenantFiles!(),
    enabled: api.supportsFileManager && open,
  });
  const files = useMemo(
    () => (filesQuery.data ?? []).filter((f) => f.contentType && allowedContentTypes.includes(f.contentType)),
    [filesQuery.data, allowedContentTypes],
  );
  const pageCount = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const pageFiles = files.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function handleClose() {
    onClose();
    setPage(0);
  }

  return (
    <Drawer open={open} onClose={handleClose} title={title} side="right">
      {error && <p className="banner-error mb-3">{error}</p>}
      {filesQuery.isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Loading…</p>
      ) : filesQuery.isError ? (
        <p className="py-10 text-center text-sm text-red-600">Couldn&apos;t load your files.</p>
      ) : files.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No reusable files yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {pageFiles.map((f) => (
              <li key={f.id} className="surface-card flex items-center justify-between gap-3 rounded-lg! px-3! py-2!">
                <div className="flex min-w-0 items-center gap-2">
                  {f.thumbnailUrl ? (
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border">
                      <Image src={f.thumbnailUrl} alt={f.fileName} fill sizes="36px" className="object-cover" />
                    </div>
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-secondary">
                      <FileIcon className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-primary" title={f.fileName}>
                      {f.fileName}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <Badge variant="neutral">{formatFileType(f.contentType)}</Badge>
                      {formatFileSize(f.sizeBytes)} · {formatDate(f.createdAt)}
                    </p>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={usingId !== null} isLoading={usingId === f.id} onClick={() => onUse(f)}>
                  Use
                </Button>
              </li>
            ))}
          </ul>
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted">
                Page {page + 1} of {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
