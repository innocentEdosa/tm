import React from "react";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, pageSize, total, onPageChange, className = "" }: PaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const isFirstPage = page <= 1;
  const isLastPage = end >= total;

  return (
    <div className={`flex items-center justify-between text-sm text-slate-500 ${className}`.trim()}>
      <span>
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={isFirstPage}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={isLastPage}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
